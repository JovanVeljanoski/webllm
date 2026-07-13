import {
  PREFS_KEY,
  THEME_KEY,
  ASSISTANT_LABEL,
  APP_VERSION,
  DEFAULT_MODEL_ID,
  DEFAULT_SYSTEM_PROMPT,
  BROWSER_LABELS,
} from "./lib/constants.js";
import {
  MODELS,
  activeModelDef as pickActiveModel,
  loadedModelDef as pickLoadedModel,
  sessionModelId,
  resolveModelIdForSession,
  modelLabel,
  modelSupportsThinking as modelHasThinking,
} from "./lib/models.js";
import {
  esc,
  formatTime,
  thinkLabel,
  statsLine,
  sessionDownloadFilename,
} from "./lib/format.js";
import {
  buildMessages as buildMessagesForModel,
  buildAgentMessages,
  exportSessionOpenAI,
  exportSessionTrace,
  splitThinking,
} from "./lib/messages.js";
import { runAgentTurn } from "./lib/agent-loop.js";
import {
  countGemmaPromptTokens,
  generateGemmaAssistant,
} from "./lib/gemma-adapter.js";
import { fitMessagesToContext } from "./lib/context-window.js";
import { createWebSearchTool } from "./lib/web-search-tool.js";
import { agentMessagesToSteps } from "./lib/agent-ui.js";
import { looksLikeToolCallSyntax, stripToolCallSyntax, hasUnclosedThoughtChannel } from "./lib/tool-parser.js";
import { sanitizeExternalText } from "./lib/sanitize.js";
import { defaultSearchProvider } from "./lib/exa-search.js";
import { GenerationTracker } from "./lib/generation-tracker.js";
import { isPrefillChunk } from "./lib/gemma-generate.js";
import { formatActivePhaseStatus, formatThinkPanelLabel } from "./lib/phase-status.js";
import { configureMarkdownParser, renderMarkdownHtml } from "./lib/markdown-render.js";
import { isPinnedToBottom, scrollToBottomIfPinned } from "./lib/chat-scroll.js";
import { focusComposerInput } from "./lib/input-focus.js";
import {
  sessionDateGroup,
  filterSessions,
  upsertSessionInList,
  createSessionRecord,
  normalizeSessionRecord,
  firstMessageTitle,
  normalizeSessionTitle,
  SESSION_GROUP_ORDER,
  canSendToModel,
  canRegenerateFromUserMessage,
  lastUserMessageContent,
  truncateSessionMessagesAfterIndex,
  updateUserMessageAtIndex,
} from "./lib/sessions.js";
import { generationErrorFallback } from "./lib/generation.js";
import { detectBrowser } from "./lib/browser.js";
import { computeLoadProgress } from "./lib/progress.js";
import {
  loadButtonLabel,
  formatAllModelsCacheStatus,
  isCacheCapable,
  clampMaxNewTokens,
} from "./lib/ui-state.js";
import { buildPrefsPayload, parsePrefsJson } from "./lib/prefs.js";
import { openSessionDB, dbGetAll, dbPut, dbDelete } from "./lib/session-storage.js";
import { createDebouncer } from "./lib/debounce.js";
import {
  createCacheEnv,
  getAllModelsCacheStats,
  checkModelCached as isModelCached,
  repairBrokenModelCache,
  deleteModelCacheDatabases,
  deleteAllModelCaches,
} from "./lib/cache.js";

"use strict";

import("https://esm.sh/marked@17")
  .then((m) => {
    m.marked.use({ gfm: true, breaks: true });
    configureMarkdownParser(m.marked);
  })
  .catch(() => {});

function activeModelDef() {
  return pickActiveModel(state.selectedModelId);
}

function loadedModelDef() {
  return pickLoadedModel(state.loadedModelId);
}

function modelSupportsThinking() {
  return modelHasThinking(state.loadedModelId, state.selectedModelId);
}

function webSearchEffective() {
  const def = loadedModelDef() || activeModelDef();
  return !!state.webSearchPreferred && !!def?.supportsTools && !!state.model;
}

function grammarConfig() {
  return {
    grammarMode: state.grammarMode,
    jsonSchema: $("grammar-json-schema")?.value || "",
    ebnf: $("grammar-custom")?.value || "",
  };
}

function buildMessages(session) {
  return buildMessagesForModel(session, grammarConfig());
}

function cacheEnv() {
  return createCacheEnv({ fileOrigin: state.fileOrigin });
}

async function checkModelCached(def = activeModelDef()) {
  return isModelCached(def, cacheEnv());
}

async function getAllModelsCacheStatsLocal() {
  return getAllModelsCacheStats(cacheEnv());
}

async function deleteAllModelCacheDatabases() {
  return deleteAllModelCaches(cacheEnv());
}

/* ── IndexedDB ── */

function disableSessionPersistence(err) {
  if (state.db?.close) {
    try { state.db.close(); } catch { /* ignore */ }
  }
  state.db = null;
  if (state.storageAvailable) {
    state.storageAvailable = false;
    console.warn("Session persistence unavailable; continuing in memory.", err);
    if (!state.storageWarningShown) {
      state.storageWarningShown = true;
      toast("Session storage is unavailable. This chat will remain only in memory.");
    }
  }
}

async function patchSessionFields(session, fields) {
  Object.assign(session, fields);
  const idx = state.sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) state.sessions[idx] = session;
  if (!state.db) return;
  try {
    await dbPut(state.db, session);
  } catch (err) {
    disableSessionPersistence(err);
  }
}

const ICONS = {
  webllm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.75 8 7.25 12l2.5 4"/><path d="M14.25 8 16.75 12l-2.5 4"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 5.75v1.5M12 16.75v1.5"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M6 20v-1a6 6 0 0 1 12 0v1"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/><path d="M3 12a9 9 0 1 1 2.64 6.36"/><path d="M3 21v-6h6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v10"/><path d="m8 11 4 4 4-4"/><path d="M5 21h14"/></svg>',
  brain: '<svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-3 3v1a2 2 0 0 0-2 2 2 2 0 0 0 0 4 2 2 0 0 0 2 2v1a3 3 0 0 0 3 3"/><path d="M15 4a3 3 0 0 1 3 3v1a2 2 0 0 1 2 2 2 2 0 0 1 0 4 2 2 0 0 1-2 2v1a3 3 0 0 1-3 3"/><path d="M9 7h6M9 17h6"/></svg>',
  wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
};

function icon(name) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = ICONS[name] || "";
  return span;
}

function setIcon(el, name) {
  el.replaceChildren(icon(name));
}

const state = {
  model: null,
  loading: false,
  busy: false,
  abort: null,
  webgpuOk: false,
  webgpuBrowser: "other",
  webgpuChecking: true,
  // file:// is an opaque origin — IndexedDB unavailable — cache disabled intentionally.
  // Production is static GitHub Pages (https://) — no server. Local dev: python3 -m http.server 8080
  fileOrigin: typeof location !== "undefined" && location.protocol === "file:",
  progress: { target: 0, shown: 0, raf: 0, label: "" },
  sessions: [],
  activeSessionId: null,
  grammarMode: "off",
  maxNewTokens: 4096,
  db: null,
  storageAvailable: true,
  storageWarningShown: false,
  renamingSessionId: null,
  sessionSearch: "",
  okBannerTimer: null,
  modelCached: false,
  webgpuLabel: "",
  modelLoadSecs: null,
  selectedModelId: DEFAULT_MODEL_ID,
  loadedModelId: null,
  gemmaScriptPromise: null,
  lfm2Runtime: null,
  webSearchPreferred: false,
};

const $ = id => document.getElementById(id);

const STEP_LABELS = {
  thinking: "Thinking",
  tool_call: "Tool call",
  tool_result: "Tool result",
  answer: ASSISTANT_LABEL,
};

function chatScrollEl() {
  return $("chat-scroll");
}

function scrollChatToBottom(force = false, pinned) {
  scrollToBottomIfPinned(chatScrollEl(), { force, pinned });
}

/* ── Toast ── */

function toast(message, { duration = 3000 } = {}) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${esc(message)}</span>`;
  $("toast-stack").appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── IndexedDB ── */

async function openDB() {
  return openSessionDB();
}

function uid() {
  return crypto.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function activeSession() {
  return state.sessions.find(s => s.id === state.activeSessionId) || null;
}

function isEmptyStateVisible() {
  const session = activeSession();
  return $("empty-state").style.display !== "none" && !session?.messages?.length;
}

async function persistSession(session) {
  session.updatedAt = Date.now();
  state.sessions = upsertSessionInList(state.sessions, session);
  savePrefs();
  renderSessionList();
  updateChatTitle();
  mountWebGpuBanner();
  updateEmptyLoader();
  if (!state.db) return;
  try {
    await dbPut(state.db, session);
  } catch (err) {
    disableSessionPersistence(err);
  }
}

async function createSession(title = "New chat") {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return null;
  }
  const session = createSessionRecord({
    id: uid(),
    title,
    selectedModelId: state.selectedModelId,
    models: MODELS,
  });
  state.activeSessionId = session.id;
  await persistSession(session);
  return session;
}

async function deleteSession(id) {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return false;
  }
  if (state.db) {
    try {
      await dbDelete(state.db, id);
    } catch (err) {
      disableSessionPersistence(err);
    }
  }
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.activeSessionId === id) {
    state.activeSessionId = state.sessions[0]?.id || null;
    if (!state.activeSessionId) await createSession();
  }
  savePrefs();
  renderSessionList();
  renderChat();
  syncUIFromSession();
  mountWebGpuBanner();
  return true;
}

async function renameSession(id, newTitle) {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return false;
  }
  const session = state.sessions.find(s => s.id === id);
  if (!session) return false;
  session.title = normalizeSessionTitle(newTitle);
  await persistSession(session);
  return true;
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(buildPrefsPayload({
      activeSessionId: state.activeSessionId,
      selectedModelId: state.selectedModelId,
      grammarMode: state.grammarMode,
      maxNewTokens: state.maxNewTokens,
      grammarJsonSchema: $("grammar-json-schema")?.value || "",
      grammarEbnf: $("grammar-custom")?.value || "",
      sessionSearch: state.sessionSearch,
      sidebarOpen: {
        conversations: $("conversations-block")?.open,
        system: $("system-block")?.open,
        model: $("model-block")?.open,
        tools: $("tools-block")?.open,
        settings: $("settings-block")?.open,
        storage: $("storage-block")?.open,
      },
      webSearchPreferred: state.webSearchPreferred,
    })));
  } catch { /* ignore */ }
}

function loadPrefs() {
  try {
    const p = parsePrefsJson(localStorage.getItem(PREFS_KEY));
    if (p.activeSessionId) state.activeSessionId = p.activeSessionId;
    if (p.grammarMode) state.grammarMode = p.grammarMode;
    if (MODELS[p.selectedModelId]) state.selectedModelId = p.selectedModelId;
    if (typeof p.maxNewTokens === "number") state.maxNewTokens = clampMaxNewTokens(p.maxNewTokens);
    if (p.grammarJsonSchema) $("grammar-json-schema").value = p.grammarJsonSchema;
    if (p.grammarEbnf) $("grammar-custom").value = p.grammarEbnf;
    if (p.sessionSearch) {
      state.sessionSearch = p.sessionSearch;
      $("session-search").value = p.sessionSearch;
    }
    state.webSearchPreferred = p.webSearchPreferred === true;
    if (p.sidebarOpen) {
      if (typeof p.sidebarOpen.conversations === "boolean") $("conversations-block").open = p.sidebarOpen.conversations;
      if (typeof p.sidebarOpen.system === "boolean") $("system-block").open = p.sidebarOpen.system;
      if (typeof p.sidebarOpen.model === "boolean") $("model-block").open = p.sidebarOpen.model;
      if (typeof p.sidebarOpen.tools === "boolean") $("tools-block").open = p.sidebarOpen.tools;
      if (typeof p.sidebarOpen.settings === "boolean") $("settings-block").open = p.sidebarOpen.settings;
      if (typeof p.sidebarOpen.storage === "boolean") $("storage-block").open = p.sidebarOpen.storage;
    }
  } catch {
    // Private browsing and enterprise policies can deny localStorage reads.
  }
}

/* ── Theme ── */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setIcon($("theme-icon"), theme === "dark" ? "sun" : "moon");
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  applyTheme(saved === "dark" || saved === "light"
    ? saved
    : (prefersDark ? "dark" : "light"));
}

/* ── Banner mounting (P0-4) ── */

function mountWebGpuBanner() {
  const banner = $("webgpu-banner");
  if (!banner.classList.contains("show")) return;
  const inline = isEmptyStateVisible();
  const mount = inline ? $("empty-banner-mount") : $("banner-top-mount");
  mount.appendChild(banner);
  banner.classList.toggle("inline", inline);
}

/* ── WebGPU ── */

function showWebGpuBanner(html, level = "error") {
  if (state.okBannerTimer) { clearTimeout(state.okBannerTimer); state.okBannerTimer = null; }
  const banner = $("webgpu-banner");
  banner.classList.add("show");
  banner.dataset.level = level;
  banner.innerHTML = html;
  mountWebGpuBanner();
  if (level === "ok") {
    state.okBannerTimer = setTimeout(hideWebGpuBanner, 5000);
  }
}

function hideWebGpuBanner() {
  if (state.okBannerTimer) { clearTimeout(state.okBannerTimer); state.okBannerTimer = null; }
  const banner = $("webgpu-banner");
  banner.classList.remove("show", "inline");
  delete banner.dataset.level;
  banner.innerHTML = "";
}

async function probeWebGPU() {
  state.webgpuChecking = true;
  state.webgpuBrowser = detectBrowser(navigator.userAgent);
  setModelStatus("loading", "Checking WebGPU…");
  updateComposerState();

  const browserLabel = BROWSER_LABELS[state.webgpuBrowser] || "this browser";

  if (!navigator.gpu) {
    state.webgpuOk = false;
    const extra = state.webgpuBrowser === "firefox"
      ? " Firefox exposes WebGPU only behind <code>dom.webgpu.enabled</code> in <code>about:config</code>."
      : " Use Chrome 113+, Edge 113+, or Safari 18+.";
    showWebGpuBanner(`<strong>WebGPU API not found.</strong> ${browserLabel} does not expose WebGPU.${extra}`, "error");
    state.webgpuChecking = false;
    setModelStatus("error", "WebGPU unavailable");
    updateComposerState();
    return;
  }

  if (state.webgpuBrowser === "firefox") {
    state.webgpuOk = false;
    showWebGpuBanner("<strong>Firefox is not supported.</strong> This WebGPU runtime is known to fail in Firefox. Use Chrome, Edge, or Safari 18+.", "warn");
    state.webgpuChecking = false;
    setModelStatus("error", "Use Chrome / Safari");
    updateComposerState();
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      state.webgpuOk = false;
      showWebGpuBanner(`<strong>No WebGPU adapter found.</strong> ${browserLabel} reported WebGPU but no compatible GPU is available.`, "error");
      state.webgpuChecking = false;
      setModelStatus("error", "No GPU adapter");
      updateComposerState();
      return;
    }

    let adapterLabel = "";
    try {
      const info = adapter.info;
      adapterLabel = info?.description || info?.device || "";
    } catch { /* ignore */ }

    state.webgpuOk = true;
    hideWebGpuBanner();

    if (state.webgpuBrowser === "safari") {
      showWebGpuBanner(`<strong>WebGPU ready on Safari.</strong>${adapterLabel ? ` GPU: ${esc(adapterLabel)}.` : ""} Safari 18+ is supported.`, "ok");
    } else if (state.webgpuBrowser === "other") {
      showWebGpuBanner(`<strong>WebGPU detected.</strong>${adapterLabel ? ` GPU: ${esc(adapterLabel)}.` : ""} Chrome, Edge, and Safari work best.`, "warn");
    }

    state.webgpuChecking = false;
    state.webgpuLabel = adapterLabel ? `WebGPU · ${adapterLabel}` : `WebGPU · ${browserLabel}`;
    setModelStatus("", state.webgpuLabel);
  } catch (err) {
    state.webgpuOk = false;
    showWebGpuBanner(`<strong>WebGPU check failed.</strong> ${esc(err?.message || err)}`, "error");
    state.webgpuChecking = false;
    setModelStatus("error", "WebGPU check failed");
  }
  updateComposerState();
}

/* ── Model loading (P0-4) ── */

function updateProgressUI(pct, label) {
  const w = (pct * 100).toFixed(1) + "%";
  $("load-bar").style.width = w;
  $("loader-bar-fill").style.width = w;
  if (label) {
    $("loader-status").textContent = label;
    state.progress.label = label;
  }
}

function setProgressTarget(v) {
  if (!Number.isFinite(v)) return;
  state.progress.target = Math.min(1, Math.max(0, Math.max(v, state.progress.target)));
  if (!state.progress.raf) state.progress.raf = requestAnimationFrame(stepBar);
}

function stepBar() {
  const p = state.progress;
  p.shown += Math.abs(p.target - p.shown) < 0.0015 ? (p.target - p.shown) : (p.target - p.shown) * 0.3;
  updateProgressUI(p.shown, p.label);
  p.raf = p.shown < p.target ? requestAnimationFrame(stepBar) : 0;
}

function setProgressImmediate(v, label) {
  if (state.progress.raf) { cancelAnimationFrame(state.progress.raf); state.progress.raf = 0; }
  state.progress.target = state.progress.shown = Math.min(1, Math.max(0, v));
  updateProgressUI(state.progress.shown, label);
}

/* ── Model cache (IndexedDB + Cache Storage via runtime) ── */

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}

async function repairBrokenModelCacheLocal() {
  const env = cacheEnv();
  const repaired = await Promise.all(Object.values(MODELS).map(def => repairBrokenModelCache(
    def,
    env,
    modelDef => deleteModelCacheDatabases(modelDef, env).catch(() => {}),
  )));
  if (repaired.some(Boolean)) {
    console.warn("Removed incomplete model cache database (missing object stores).");
  }
}

async function clearModelCache() {
  if (state.loading || state.busy) {
    toast("Wait until the model finishes loading.");
    return false;
  }
  const hadLoadedModel = !!state.model;
  if (hadLoadedModel) await unloadModel();
  try {
    await deleteAllModelCacheDatabases();
  } catch (err) {
    toast(err?.message || "Could not clear model cache");
    return false;
  }
  state.modelCached = await checkModelCached(activeModelDef());
  await refreshStorageUI();
  toast("All model caches cleared.");
  if (hadLoadedModel) {
    toast("Model unloaded. Load again to re-download weights.");
  }
  return true;
}

function updateStorageButtons() {
  const clearBtn = $("clear-model-cache-btn");
  if (!clearBtn) return;
  const busy = state.loading || state.busy;
  const cacheCapable = isCacheCapable({
    fileOrigin: state.fileOrigin,
    caches: globalThis.caches,
    indexedDB: globalThis.indexedDB,
    models: MODELS,
  });
  clearBtn.disabled = !cacheCapable || busy;
  clearBtn.title = state.fileOrigin
    ? "Caching unavailable on file://"
    : (!cacheCapable ? "Caching not supported in this browser context" : "Clear cached weights for all models");
}

function updateEmptyCacheHint() {
  const hint = $("empty-cache-hint");
  if (!hint) return;
  const def = activeModelDef();
  if (state.fileOrigin) {
    hint.textContent = "";
    return;
  }
  if (state.modelCached) {
    hint.textContent = `${def.name} cached locally · loads in seconds.`;
  } else {
    hint.textContent = `First load downloads ${def.downloadHint} (one-time).`;
  }
}

async function ensureGemmaRuntime() {
  if (typeof globalThis.Gemma4Mobile === "function") return true;
  if (!state.gemmaScriptPromise) {
    state.gemmaScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "gemma-4-e2b.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Gemma runtime"));
      document.head.appendChild(script);
    });
  }
  try {
    await state.gemmaScriptPromise;
  } catch (err) {
    console.error(err);
    state.gemmaScriptPromise = null;
    return false;
  }
  return typeof globalThis.Gemma4Mobile === "function";
}

async function ensureRuntime(def = activeModelDef()) {
  if (!def) return false;
  if (def.runtime === "gemma") return ensureGemmaRuntime();
  if (!state.lfm2Runtime) {
    try {
      const mod = await import("./lfm2_5.js");
      state.lfm2Runtime = mod.Lfm2Mobile;
    } catch (err) {
      console.error(err);
      return false;
    }
  }
  return !!state.lfm2Runtime;
}

function resetLoadedModel() {
  if (!state.model || typeof state.model.reset !== "function") return;
  try { state.model.reset(); } catch { /* ignore */ }
}

async function unloadModel() {
  if (state.busy || state.loading) return false;
  if (!state.model) {
    state.loadedModelId = null;
    return true;
  }
  try {
    if (typeof state.model.reset === "function") await state.model.reset();
    if (typeof state.model.dispose === "function") await state.model.dispose();
  } catch { /* ignore */ }
  state.model = null;
  state.loadedModelId = null;
  state.modelLoadSecs = null;
  restoreIdleStatus();
  updateComposerState();
  renderModelPicker();
  return true;
}

function renderModelPicker() {
  const picker = $("model-picker");
  if (!picker) return;
  const busy = state.loading || state.busy;
  picker.innerHTML = Object.values(MODELS).map(def => {
    const active = def.id === state.selectedModelId;
    const loaded = state.loadedModelId === def.id && !!state.model;
    return `
      <label class="model-option${active ? " active" : ""}${busy ? " disabled" : ""}">
        <input type="radio" name="model-id" value="${esc(def.id)}"${active ? " checked" : ""}${busy ? " disabled" : ""}>
        <span class="model-option-name">${esc(def.name)}</span>
        <span class="model-option-meta">${esc(def.subtitle)}</span>
        ${loaded ? '<span class="model-option-badge">Loaded</span>' : ""}
      </label>`;
  }).join("");
}

async function applyModelSelection(modelId, { silent = false, persistToSession = true } = {}) {
  if (!MODELS[modelId]) modelId = DEFAULT_MODEL_ID;
  const needsUnload = state.model && state.loadedModelId && state.loadedModelId !== modelId;
  if (modelId === state.selectedModelId && !needsUnload) {
    renderModelPicker();
    return;
  }
  if (state.busy || state.loading) {
    if (!silent) {
      toast("Can't switch models while loading or generating.");
      renderModelPicker();
    }
    return;
  }
  if (state.model && state.loadedModelId && state.loadedModelId !== modelId) {
    await unloadModel();
    if (!silent) toast(`Switched to ${MODELS[modelId].name}. Load the model when ready.`);
  }
  state.selectedModelId = modelId;
  if (persistToSession) {
    const session = activeSession();
    if (session && session.modelId !== modelId) {
      await patchSessionFields(session, { modelId });
      renderSessionList();
    }
  }
  savePrefs();
  renderModelPicker();
  updateWebSearchUI();
  await refreshStorageUI();
  updateEmptyCacheHint();
}

async function selectModel(modelId) {
  await applyModelSelection(modelId, { silent: false, persistToSession: true });
}

function syncModelFromSession(session = activeSession()) {
  if (!session) return;
  state.selectedModelId = resolveModelIdForSession(session, state.selectedModelId);
  renderModelPicker();
}

async function refreshStorageUI() {
  const def = activeModelDef();
  state.modelCached = await checkModelCached(def);
  const statusText = $("storage-status-text");
  if (statusText) {
    if (state.fileOrigin) {
      statusText.hidden = true;
    } else {
      statusText.hidden = false;
      const cacheOk = isCacheCapable({
        fileOrigin: state.fileOrigin,
        caches: globalThis.caches,
        indexedDB: globalThis.indexedDB,
        models: MODELS,
      });
      if (!cacheOk) {
        statusText.textContent = "Caching not available";
      } else {
        const stats = await getAllModelsCacheStatsLocal();
        statusText.textContent = formatAllModelsCacheStatus(stats);
      }
    }
  }
  updateStorageButtons();
  updateEmptyCacheHint();
  updateComposerState();
}

function restoreIdleStatus() {
  if (state.busy || state.loading) return;
  if (state.model && state.webgpuLabel) setModelStatus("ready", state.webgpuLabel);
  else if (state.webgpuLabel) setModelStatus("", state.webgpuLabel);
  else if (!state.webgpuOk) setModelStatus("error", "WebGPU unavailable");
  else setModelStatus("", "Not loaded");
}

function onLoadProgress(event) {
  const { target, label } = computeLoadProgress(event, activeModelDef());
  if (target != null) setProgressTarget(target);
  state.progress.label = label;
  setModelStatus("loading", label);
}

function setModelStatus(kind, text) {
  const full = text || "Not loaded";
  $("model-status").className = "status-chip" + (kind ? ` ${kind}` : "");
  $("model-status").title = full;
  $("model-status-text").textContent = full;
  if (isEmptyStateVisible() && state.loading && $("empty-loader-progress").hidden === false) {
    $("loader-status").textContent = full;
  }
}

function updateEmptyLoader() {
  const empty = isEmptyStateVisible();
  const showHero = empty && !state.model;
  $("empty-loader").style.display = showHero ? "" : "none";
  if (!showHero) return;

  if (state.loading) {
    $("empty-loader-idle").hidden = true;
    $("empty-loader-progress").hidden = false;
  } else {
    $("empty-loader-idle").hidden = false;
    $("empty-loader-progress").hidden = true;
  }
  mountWebGpuBanner();
}

function updateComposerState() {
  const canSend = state.model && !state.busy && !state.loading;
  const sessionLocked = state.busy || state.loading;
  const canStop = state.busy && !!state.abort;
  $("user-input").disabled = !canSend;
  $("send-btn").disabled = !canSend;
  $("send-btn").style.display = state.busy ? "none" : "";
  $("stop-btn").style.display = canStop ? "" : "none";
  $("stop-btn").disabled = !canStop || state.abort?.signal.aborted;
  $("stop-btn").textContent = state.abort?.signal.aborted ? "Stopping…" : "Stop";
  $("new-chat-btn").disabled = sessionLocked;
  $("chat-title-edit").disabled = sessionLocked;
  $("system-prompt").disabled = sessionLocked;
  $("session-search").disabled = sessionLocked;

  const loadDisabled = state.loading || state.busy || !state.webgpuOk || state.webgpuChecking || !!state.model;
  for (const btn of [$("load-model-btn"), $("load-model-btn-hero")]) {
    if (!btn) continue;
    btn.disabled = loadDisabled;
    btn.textContent = loadButtonLabel({
      model: state.model,
      loading: state.loading,
      modelCached: state.modelCached,
      fileOrigin: state.fileOrigin,
      isHero: btn.id === "load-model-btn-hero",
    });
    btn.title = state.model && state.modelLoadSecs ? `Loaded in ${state.modelLoadSecs}s` : "";
  }

  const topbarBtn = $("load-model-btn");
  if (topbarBtn) {
    topbarBtn.classList.toggle("primary", !isEmptyStateVisible() && !state.model);
    topbarBtn.hidden = isEmptyStateVisible() && !state.model && !state.loading;
  }

  updateEmptyLoader();
  updateStorageButtons();
}

async function loadModel() {
  if (state.model || state.loading || !state.webgpuOk) return;
  const def = activeModelDef();
  state.loading = true;
  updateComposerState();
  renderModelPicker();
  $("load-bar-wrap").classList.add("show");
  setProgressImmediate(0.02, "Requesting WebGPU…");
  setModelStatus("loading", "Requesting WebGPU…");
  const started = performance.now();
  try {
    if (!(await ensureRuntime(def))) {
      throw new Error("Model runtime could not be loaded");
    }
    const loadOpts = {
      onProgress: onLoadProgress,
      cacheName: def.cacheName,
      revision: def.revision,
    };
    if (state.fileOrigin) loadOpts.cache = false;
    if (def.runtime === "gemma") {
      state.model = await globalThis.Gemma4Mobile.load(null, loadOpts);
    } else {
      state.model = await state.lfm2Runtime.load(def.hubId, loadOpts);
    }
    setModelStatus("loading", "Warming up…");
    state.progress.label = "Warming up…";
    setProgressTarget(0.99);
    await state.model.warmup();
    setProgressImmediate(1, "Model ready");
    state.modelLoadSecs = ((performance.now() - started) / 1000).toFixed(1);
    state.loadedModelId = def.id;
    restoreIdleStatus();
    setTimeout(() => $("load-bar-wrap").classList.remove("show"), 500);
    requestPersistentStorage();
    state.modelCached = await checkModelCached(def);
    if (!state.modelCached && !state.fileOrigin) {
      toast("Model loaded, but couldn't be cached (browser may be low on storage). It will re-download next time.");
    }
    await refreshStorageUI();
    renderModelPicker();
  } catch (err) {
    console.error(err);
    setModelStatus("error", `Failed · ${err?.message || err}`);
    toast(`Model failed to load: ${err?.message || err}`);
    const failedModel = state.model;
    state.model = null;
    state.loadedModelId = null;
    state.modelLoadSecs = null;
    state.modelCached = false;
    if (failedModel) {
      try {
        if (typeof failedModel.reset === "function") await failedModel.reset();
        if (typeof failedModel.dispose === "function") await failedModel.dispose();
      } catch (disposeError) {
        console.warn("Could not dispose failed model runtime.", disposeError);
      }
    }
    setProgressImmediate(0, "Ready to retry");
    $("load-bar-wrap").classList.remove("show");
  } finally {
    state.loading = false;
    updateComposerState();
    updateWebSearchUI();
    renderModelPicker();
  }
}

/* ── Export ── */

let pendingDownloadSessionId = null;
let queuedDownload = null;

function downloadSession(sessionId, format = "conversation") {
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  if (!session.messages?.length) {
    toast("Nothing to download — this conversation is empty");
    return;
  }
  const fullTrace = format === "trace";
  const recordedMode = session.lastExecution?.mode;
  const agentMode = recordedMode
    ? recordedMode === "agent"
    : webSearchEffective()
      || session.messages.some(message => message.role === "tool" || message.tool_calls?.length);
  const payload = fullTrace
    ? exportSessionTrace(session, {
      agentMode,
      grammarConfig: grammarConfig(),
    })
    : exportSessionOpenAI(session);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const filename = sessionDownloadFilename(session.title);
  a.download = fullTrace ? filename.replace(/\.json$/i, ".trace.json") : filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Downloaded "${session.title}"${fullTrace ? " (full trace)" : ""}`);
}

function openDownloadDialog(sessionId) {
  if (!state.sessions.some(session => session.id === sessionId)) return;
  pendingDownloadSessionId = sessionId;
  const defaultFormat = document.querySelector(
    '#download-dialog input[name="download-format"][value="conversation"]',
  );
  if (defaultFormat) defaultFormat.checked = true;
  $("download-dialog").showModal();
}

function closeDownloadDialog() {
  pendingDownloadSessionId = null;
  $("download-dialog").close();
}

function confirmDownload() {
  const sessionId = pendingDownloadSessionId;
  const format = document.querySelector(
    '#download-dialog input[name="download-format"]:checked',
  )?.value || "conversation";
  closeDownloadDialog();
  if (!sessionId) return;
  if (state.busy) {
    queuedDownload = { sessionId, format };
    toast("Download queued — it will start when the response finishes.");
    return;
  }
  downloadSession(sessionId, format);
}

function flushQueuedDownload() {
  if (state.busy || !queuedDownload) return;
  const request = queuedDownload;
  queuedDownload = null;
  setTimeout(() => downloadSession(request.sessionId, request.format), 0);
}

function createAvatar(kind) {
  const av = document.createElement("div");
  av.className = `avatar ${kind}`;
  const iconName = {
    user: "user",
    assistant: "spark",
    thinking: "brain",
    tool: "wrench",
  }[kind] || "spark";
  setIcon(av, iconName);
  return av;
}

function createMsgShell(roleName, { headActions = null } = {}) {
  const inner = document.createElement("div");
  inner.className = "msg-inner";
  const body = document.createElement("div");
  body.className = "msg-body";
  const card = document.createElement("div");
  card.className = "msg-card";
  const head = document.createElement("div");
  head.className = "msg-card-head";
  const role = document.createElement("div");
  role.className = "msg-role";
  role.textContent = roleName;
  head.appendChild(role);
  if (headActions) head.appendChild(headActions);
  card.appendChild(head);
  body.appendChild(card);
  return { inner, body, card, head };
}

function resolveCopyText(btn) {
  if (typeof btn._copyText === "string" && btn._copyText.length > 0) return btn._copyText;
  const sourceSel = btn.dataset.copySource;
  if (sourceSel) {
    const root = btn.closest(".msg-card") || btn.closest("details") || btn.closest(".msg");
    const el = root?.querySelector(sourceSel);
    if (el?.dataset?.rawMarkdown != null) return el.dataset.rawMarkdown;
    if (el) return el.textContent || "";
  }
  const response = btn.closest(".msg")?.querySelector(".response-content");
  if (response?.dataset?.rawMarkdown != null) return response.dataset.rawMarkdown;
  return response?.textContent || "";
}

function appendResponseStreamCursor(container) {
  const cursor = document.createElement("span");
  cursor.className = "stream-cursor";
  const anchor = container.querySelector("p:last-of-type, li:last-of-type, pre:last-of-type, h1:last-of-type, h2:last-of-type, h3:last-of-type");
  (anchor || container).appendChild(cursor);
}

function setResponseContent(el, markdown, { streaming = false } = {}) {
  if (!el) return;
  const raw = markdown || "";
  const cursor = el.querySelector(".stream-cursor");
  if (streaming) {
    if (el.dataset.rawMarkdown !== raw) {
      el.dataset.rawMarkdown = raw;
      delete el.dataset.renderedMarkdown;
      el.textContent = raw;
    }
    if (raw && !el.querySelector(".stream-cursor")) {
      appendResponseStreamCursor(el);
    }
    return;
  }
  if (el.dataset.renderedMarkdown === raw) {
    cursor?.remove();
    return;
  }
  el.dataset.rawMarkdown = raw;
  el.dataset.renderedMarkdown = raw;
  el.innerHTML = renderMarkdownHtml(raw);
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  if (!document.execCommand("copy")) throw new Error("copy failed");
  ta.remove();
}

async function performCopy(btn) {
  const text = resolveCopyText(btn);
  if (!text) {
    toast("Nothing to copy");
    return;
  }
  try {
    await writeClipboard(text);
    const label = btn.querySelector(".copy-label");
    if (label) {
      label.textContent = " Copied";
      setTimeout(() => { label.textContent = " Copy"; }, 1500);
    }
    toast("Copied to clipboard");
  } catch {
    toast("Copy failed");
  }
}

function createCopyButton({ text = "", copySource = "", compact = false, label = "Copy" } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = compact ? "footer-action copy-action-icon" : "footer-action";
  btn.dataset.copy = "1";
  btn.setAttribute("aria-label", label);
  btn.append(icon("copy"));
  if (text) btn._copyText = text;
  if (copySource) btn.dataset.copySource = copySource;
  if (!compact) {
    const copyLabel = document.createElement("span");
    copyLabel.className = "copy-label";
    copyLabel.textContent = " Copy";
    btn.append(copyLabel);
  }
  btn.addEventListener("click", e => {
    e.stopPropagation();
    e.preventDefault();
    performCopy(btn);
  });
  return btn;
}

function createIconButton({ name, label, onClick, compact = true } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = compact ? "footer-action copy-action-icon" : "footer-action";
  btn.setAttribute("aria-label", label);
  btn.append(icon(name));
  btn.addEventListener("click", e => {
    e.stopPropagation();
    e.preventDefault();
    onClick?.(e, btn);
  });
  return btn;
}

function buildUserMessageHeadActions(messageIndex) {
  const actions = document.createElement("span");
  actions.className = "msg-head-actions";
  actions.append(
    createCopyButton({ compact: true, copySource: ".msg-content", label: "Copy message" }),
    createIconButton({
      name: "edit",
      label: "Edit message",
      onClick: () => startUserMessageEdit(messageIndex),
    }),
    createIconButton({
      name: "refresh",
      label: "Regenerate from here",
      onClick: () => rerunFromUserMessage(messageIndex),
    }),
  );
  return actions;
}

function userMessageEl(messageIndex) {
  return document.querySelector(`.msg.user[data-msg-index="${messageIndex}"]`);
}

function generationSendCheck(session) {
  const expectedModelId = resolveModelIdForSession(session, state.selectedModelId);
  return {
    expectedModelId,
    ...canSendToModel({
      text: lastUserMessageContent(session) || "x",
      model: state.model,
      busy: state.busy,
      loadedModelId: state.loadedModelId,
      expectedModelId,
    }),
  };
}

async function commitUserMessageEdit(messageIndex, content) {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return false;
  }
  const session = activeSession();
  if (!session) return false;
  const next = updateUserMessageAtIndex(session, messageIndex, content);
  if (!next) {
    toast("Message cannot be empty");
    return false;
  }
  Object.assign(session, next);
  session.systemPrompt = $("system-prompt").value;
  await persistSession(session);
  renderChat();
  return true;
}

function startUserMessageEdit(messageIndex) {
  if (state.busy || state.loading) {
    toast("Wait for the current response to finish");
    return;
  }
  const session = activeSession();
  if (!session?.messages[messageIndex] || session.messages[messageIndex].role !== "user") return;

  const wrap = userMessageEl(messageIndex);
  if (!wrap || wrap.dataset.editing === "1") return;

  const contentEl = wrap.querySelector(".msg-content");
  const headActions = wrap.querySelector(".msg-head-actions");
  if (!contentEl || !headActions) return;

  const original = contentEl.textContent || "";
  wrap.classList.add("editing");
  wrap.dataset.editing = "1";

  const ta = document.createElement("textarea");
  ta.className = "msg-edit-input";
  ta.value = original;
  ta.rows = 1;
  contentEl.replaceWith(ta);
  autoResizeTextarea(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  headActions.replaceChildren(
    createIconButton({
      name: "check",
      label: "Save edit",
      onClick: async () => { await finishUserMessageEdit(messageIndex, true); },
    }),
    createIconButton({
      name: "close",
      label: "Cancel edit",
      onClick: () => { finishUserMessageEdit(messageIndex, false); },
    }),
  );

  let done = false;
  const finishUserMessageEdit = async (idx, save) => {
    if (done) return;
    done = true;
    wrap.dataset.editing = "0";
    wrap.classList.remove("editing");
    if (save) {
      const next = ta.value.trim();
      if (!next) {
        toast("Message cannot be empty");
        renderChat();
        return;
      }
      await commitUserMessageEdit(idx, next);
      return;
    }
    renderChat();
  };

  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishUserMessageEdit(messageIndex, true);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finishUserMessageEdit(messageIndex, false);
    }
  });
}

async function rerunFromUserMessage(messageIndex) {
  if (state.busy || state.loading) {
    toast("Wait for the current response to finish");
    return;
  }
  const session = activeSession();
  if (!session || !canRegenerateFromUserMessage(session, messageIndex)) return;

  const sendCheck = generationSendCheck(session);
  if (!sendCheck.ok) {
    if (sendCheck.reason === "model_mismatch") {
      toast(`Load ${modelLabel(sendCheck.expectedModelId)} before regenerating in this chat.`);
    } else {
      toast("Load a model before regenerating.");
    }
    return;
  }

  const truncated = truncateSessionMessagesAfterIndex(session, messageIndex);
  session.messages = truncated.messages;
  session.systemPrompt = $("system-prompt").value;
  state.busy = true;
  updateComposerState();
  try {
    await persistSession(session);
  } catch (err) {
    console.error(err);
    state.busy = false;
    updateComposerState();
    flushQueuedDownload();
    toast("Could not save the edited conversation.");
    return;
  }
  renderChat({ scrollForce: true });
  await runAssistantGeneration(session);
}

function buildUserMessage(content, messageIndex) {
  const wrap = document.createElement("div");
  wrap.className = "msg user";
  wrap.dataset.msgIndex = String(messageIndex);
  const shell = createMsgShell("You", { headActions: buildUserMessageHeadActions(messageIndex) });
  shell.inner.append(createAvatar("user"), shell.body);
  const contentEl = document.createElement("div");
  contentEl.className = "msg-content";
  contentEl.textContent = content;
  shell.card.appendChild(contentEl);
  wrap.appendChild(shell.inner);
  return wrap;
}

function appendSummaryCopy(summary, { text = "", copySource = "" } = {}) {
  const actions = document.createElement("span");
  actions.className = "summary-actions";
  actions.appendChild(createCopyButton({ compact: true, text, copySource, label: "Copy" }));
  const chev = summary.querySelector(".chevron");
  if (chev) actions.appendChild(chev);
  summary.appendChild(actions);
}

function buildAssistantMessage(msg, { streaming = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant" + (streaming ? " streaming" : "");
  if (streaming) wrap.id = "streaming-msg";

  const shell = createMsgShell(ASSISTANT_LABEL);
  shell.inner.append(createAvatar("assistant"), shell.body);

  const thinking = msg?.thinking || "";
  const content = msg?.content || "";
  const disclosure = buildThinkingDisclosure(thinking, msg?.meta, { streaming, open: streaming && !content });
  if (disclosure) shell.card.appendChild(disclosure);

  const response = document.createElement("div");
  response.className = "response-content";
  if (!streaming || content) setResponseContent(response, content);
  shell.card.appendChild(response);

  if (!streaming) {
    shell.card.appendChild(buildMsgFooter(content, msg?.meta));
  } else {
    const footer = document.createElement("div");
    footer.className = "msg-footer stream-footer";
    const stats = document.createElement("span");
    stats.className = "msg-stats-inline";
    stats.textContent = "…";
    footer.appendChild(stats);
    shell.card.appendChild(footer);
  }

  wrap.appendChild(shell.inner);
  return wrap;
}

function buildThinkingDisclosure(thinking, meta, { streaming = false, open = false } = {}) {
  if (!streaming && !thinking) return null;
  const details = document.createElement("details");
  details.className = "think-disclosure";
  if (open || streaming) details.open = true;

  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.className = "think-label";
  label.textContent = streaming && !thinking ? "Thinking…" : thinkLabel(meta, thinking);
  const chev = icon("chevron");
  chev.classList.add("chevron");
  summary.append(icon("brain"), label, chev);
  appendSummaryCopy(summary, { copySource: ".think-content" });

  const content = document.createElement("div");
  content.className = "think-content";
  if (streaming && !thinking) {
    content.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  } else {
    content.textContent = thinking;
  }

  details.append(summary, content);
  return details;
}

function buildMsgFooter(content, meta) {
  const footer = document.createElement("div");
  footer.className = "msg-footer";
  const copyBtn = createCopyButton({ text: content });
  const stats = document.createElement("span");
  stats.className = "msg-stats-inline";
  stats.textContent = statsLine(meta);
  footer.append(copyBtn, stats);
  return footer;
}

function buildThinkingStepPanel(thinking, label, { streaming = false, streamStatus = "" } = {}) {
  const details = document.createElement("details");
  details.className = "think-disclosure";
  details.open = true;

  const summary = document.createElement("summary");
  const labelEl = document.createElement("span");
  labelEl.className = "think-label";
  labelEl.textContent = streaming && !thinking ? `${label || "Thinking"}…` : (label || "Thinking");
  const chev = icon("chevron");
  chev.classList.add("chevron");
  summary.append(icon("brain"), labelEl, chev);
  appendSummaryCopy(summary, { copySource: ".think-content" });

  const content = document.createElement("div");
  content.className = "think-content";
  if (streaming && !thinking) {
    content.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  } else {
    content.textContent = thinking;
  }

  details.append(summary, content);

  const wrap = document.createDocumentFragment();
  wrap.appendChild(details);
  if (streaming && streamStatus) {
    const footer = document.createElement("div");
    footer.className = "msg-footer stream-footer";
    const stats = document.createElement("span");
    stats.className = "msg-stats-inline";
    stats.textContent = streamStatus;
    footer.appendChild(stats);
    wrap.appendChild(footer);
  }
  return wrap;
}

function buildAgentStepMessage(step, { streamStatus = "" } = {}) {
  const wrap = document.createElement("div");
  const typeClass = step.type.replaceAll("_", "-");
  wrap.className = `msg agent-step ${typeClass}` + (step.type === "answer" ? " assistant" : "") + (step.streaming ? " streaming" : "");

  const avatarKind = step.type === "thinking" || step.type === "runtime_status"
    ? "thinking"
    : (step.type === "tool_call" || step.type === "tool_result" ? "tool" : "assistant");
  const isWebSearch = step.toolName === "web_search";
  const roleName = isWebSearch && step.type === "tool_call"
    ? "Web search"
    : (isWebSearch && step.type === "tool_result"
      ? "Search results"
      : (STEP_LABELS[step.type] || step.label || ASSISTANT_LABEL));
  const shell = createMsgShell(roleName, step.type === "tool_call" ? { copySource: ".tool-query-line" } : {});
  shell.inner.append(createAvatar(avatarKind), shell.body);

  if (step.type === "runtime_status") {
    const status = document.createElement("div");
    status.className = "runtime-status-line";
    status.innerHTML = '<span class="search-spinner" aria-hidden="true"></span><span>Preparing model context…</span>';
    shell.card.appendChild(status);
    const footer = document.createElement("div");
    footer.className = "msg-footer stream-footer";
    const stats = document.createElement("span");
    stats.className = "msg-stats-inline";
    stats.textContent = streamStatus || "Prefill…";
    footer.appendChild(stats);
    shell.card.appendChild(footer);
  } else if (step.type === "thinking") {
    shell.card.appendChild(buildThinkingStepPanel(step.thinking || "", step.label, {
      streaming: step.streaming,
      streamStatus,
    }));
  } else if (step.type === "tool_call") {
    const q = document.createElement("div");
    q.className = "tool-query-line";
    q.textContent = isWebSearch
      ? (step.searching ? `Searching the web for “${step.query}”…` : `Query: “${step.query}”`)
      : `${step.toolName}: ${step.query}`;
    shell.card.appendChild(q);
    if (step.searching) {
      const searching = document.createElement("div");
      searching.className = "tool-searching";
      searching.innerHTML = `<span class="search-spinner" aria-hidden="true"></span><span>${isWebSearch ? "Running search via Exa MCP…" : "Running tool…"}</span>`;
      shell.card.appendChild(searching);
    }
  } else if (step.type === "tool_result") {
    const details = document.createElement("details");
    details.className = "tool-result-disclosure";
    details.open = false;
    const summary = document.createElement("summary");
    const count = step.resultCount ?? 0;
    const statusSuffix = step.status && step.status !== "ok" ? ` (${step.status})` : "";
    const label = document.createElement("span");
    label.className = "tool-result-label";
    label.textContent = isWebSearch
      ? `${count} result${count === 1 ? "" : "s"} for “${step.query}”${statusSuffix}`
      : `${step.toolName}${statusSuffix}`;
    const chev = icon("chevron");
    chev.classList.add("chevron");
    summary.append(label, chev);
    appendSummaryCopy(summary, { copySource: ".tool-result-content" });
    const body = document.createElement("div");
    body.className = "tool-result-content";
    body.textContent = step.content || "";
    details.append(summary, body);
    shell.card.appendChild(details);
  } else if (step.type === "answer") {
    const response = document.createElement("div");
    response.className = "response-content";
    setResponseContent(response, step.content || "", { streaming: step.streaming && !!step.content });
    shell.card.appendChild(response);
    if (step.streaming && streamStatus) {
      const footer = document.createElement("div");
      footer.className = "msg-footer stream-footer";
      const stats = document.createElement("span");
      stats.className = "msg-stats-inline";
      stats.textContent = streamStatus;
      footer.appendChild(stats);
      shell.card.appendChild(footer);
    } else if (!step.streaming) {
      shell.card.appendChild(buildMsgFooter(step.content || "", step.meta));
    }
  }

  wrap.appendChild(shell.inner);
  return wrap;
}

function updateAgentStepElement(el, step, streamStatus = "") {
  el.classList.toggle("streaming", !!step.streaming);
  const card = el.querySelector(".msg-card");
  if (!card) return;

  if (step.type === "runtime_status") {
    const stats = el.querySelector(".msg-stats-inline");
    if (stats) stats.textContent = streamStatus || "Prefill…";
    return;
  }

  if (step.type === "thinking") {
    const label = step.label || "Thinking";
    const labelEl = el.querySelector(".think-label");
    if (labelEl) {
      labelEl.textContent = step.streaming && !step.thinking ? `${label}…` : label;
    }
    const thinkContent = el.querySelector(".think-content");
    if (thinkContent) {
      if (step.streaming && !step.thinking) {
        if (!thinkContent.querySelector(".thinking-dots")) {
          thinkContent.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
        }
      } else if (thinkContent.textContent !== (step.thinking || "")) {
        thinkContent.textContent = step.thinking || "";
      }
    }
    let footer = el.querySelector(".stream-footer");
    if (step.streaming && streamStatus) {
      if (!footer) {
        footer = document.createElement("div");
        footer.className = "msg-footer stream-footer";
        const stats = document.createElement("span");
        stats.className = "msg-stats-inline";
        footer.appendChild(stats);
        card.appendChild(footer);
      }
      footer.querySelector(".msg-stats-inline").textContent = streamStatus;
    } else {
      footer?.remove();
    }
    return;
  }

  if (step.type === "tool_call") {
    const isWebSearch = step.toolName === "web_search";
    const q = el.querySelector(".tool-query-line");
    if (q) {
      q.textContent = isWebSearch
        ? (step.searching ? `Searching the web for “${step.query}”…` : `Query: “${step.query}”`)
        : `${step.toolName}: ${step.query}`;
    }
    let searching = el.querySelector(".tool-searching");
    if (step.searching) {
      if (!searching) {
        searching = document.createElement("div");
        searching.className = "tool-searching";
        searching.innerHTML = `<span class="search-spinner" aria-hidden="true"></span><span>${isWebSearch ? "Running search via Exa MCP…" : "Running tool…"}</span>`;
        card.appendChild(searching);
      }
    } else {
      searching?.remove();
    }
    return;
  }

  if (step.type === "answer") {
    const response = el.querySelector(".response-content");
    if (response) {
      setResponseContent(response, step.content || "", { streaming: step.streaming && !!step.content });
    }
    let footer = el.querySelector(".stream-footer");
    if (step.streaming && streamStatus) {
      if (!footer) {
        footer = document.createElement("div");
        footer.className = "msg-footer stream-footer";
        const stats = document.createElement("span");
        stats.className = "msg-stats-inline";
        footer.appendChild(stats);
        card.appendChild(footer);
      }
      footer.querySelector(".msg-stats-inline").textContent = streamStatus;
    } else if (!step.streaming) {
      footer?.remove();
      if (!card.querySelector(".msg-footer:not(.stream-footer)")) {
        card.appendChild(buildMsgFooter(step.content || "", step.meta));
      }
    }
  }
}

/* ── Rendering ── */

function updateChatTitle() {
  const session = activeSession();
  $("chat-title").textContent = session?.title || "New chat";
}

function startRenameSession(id) {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return;
  }
  state.renamingSessionId = id;
  renderSessionList();
}

function finishRenameSession(id, value) {
  state.renamingSessionId = null;
  renameSession(id, value);
}

function startRenameActiveChat() {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return;
  }
  const session = activeSession();
  if (!session) return;
  const wrap = $("chat-title").parentElement;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "chat-title-input";
  input.value = session.title;
  input.maxLength = 80;
  wrap.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const restore = () => {
    const h = document.createElement("h2");
    h.className = "chat-title";
    h.id = "chat-title";
    h.textContent = activeSession()?.title || "New chat";
    h.addEventListener("dblclick", startRenameActiveChat);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "chat-title-edit";
    edit.id = "chat-title-edit";
    edit.setAttribute("aria-label", "Rename conversation");
    edit.title = "Rename";
    edit.addEventListener("click", startRenameActiveChat);
    setIcon(edit, "edit");
    wrap.replaceChildren(h, edit);
  };
  const commit = () => {
    if (done) return;
    done = true;
    renameSession(session.id, input.value);
    restore();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { done = true; restore(); }
  });
}

function bindSessionDeleteConfirm(btn) {
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const row = btn.closest(".session-item");
    const sessionId = btn.dataset.del;
    const title = row.querySelector(".session-title")?.textContent || "Conversation";
    const actions = row.querySelector(".session-actions");
    row.classList.add("confirming");
    actions.innerHTML = `
      <span class="confirm-label">Delete?</span>
      <button type="button" class="icon-btn" data-cancel aria-label="Cancel"></button>
      <button type="button" class="icon-btn danger" data-confirm aria-label="Confirm delete"></button>`;
    setIcon(actions.querySelector("[data-cancel]"), "close");
    setIcon(actions.querySelector("[data-confirm]"), "trash");

    const revert = () => {
      row.classList.remove("confirming");
      renderSessionList();
    };
    let timer = setTimeout(revert, 4000);
    actions.querySelector("[data-cancel]").onclick = ev => { ev.stopPropagation(); clearTimeout(timer); revert(); };
    actions.querySelector("[data-confirm]").onclick = async ev => {
      ev.stopPropagation();
      clearTimeout(timer);
      if (await deleteSession(sessionId)) toast(`"${title}" deleted`);
    };
  });
}

function renderSessionList() {
  const list = $("session-list");
  const sessions = filterSessions(state.sessions, state.sessionSearch);
  $("session-search-wrap").classList.toggle("show", state.sessions.length > 8);
  const countEl = $("conv-count");
  if (countEl) countEl.textContent = state.sessions.length ? `(${state.sessions.length})` : "";

  if (!sessions.length) {
    list.innerHTML = `<div style="padding:8px 12px;font-size:12px;color:var(--text-muted)">${state.sessionSearch ? "No matches" : "No conversations"}</div>`;
    return;
  }

  const groups = new Map();
  for (const s of sessions) {
    const g = sessionDateGroup(s.updatedAt);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  const order = SESSION_GROUP_ORDER;
  list.innerHTML = order.filter(g => groups.has(g)).map(g => {
    const items = groups.get(g).map(s => {
      const renaming = state.renamingSessionId === s.id;
      return `
        <div class="session-item ${s.id === state.activeSessionId ? "active" : ""}" data-id="${esc(s.id)}" tabindex="0">
          <div class="session-row">
            ${renaming
              ? `<input class="session-title-input" data-rename-input="${esc(s.id)}" value="${esc(s.title)}">`
              : `<span class="session-title" title="${esc(s.title)}">${esc(s.title)}</span>`}
            <div class="session-actions">
              <button type="button" class="icon-btn" data-rename="${esc(s.id)}" aria-label="Rename" title="Rename"></button>
              <button type="button" class="icon-btn" data-download="${esc(s.id)}" aria-label="Download conversation" title="Download JSON"></button>
              <button type="button" class="icon-btn danger" data-del="${esc(s.id)}" aria-label="Delete" title="Delete"></button>
            </div>
          </div>
          <div class="session-meta">${esc(modelLabel(resolveModelIdForSession(s, state.selectedModelId)))} · ${s.messages.length} messages · ${formatTime(s.updatedAt)}</div>
        </div>`;
    }).join("");
    return `<div class="session-group-label">${g}</div>${items}`;
  }).join("");

  list.querySelectorAll(".session-item").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".icon-btn") || e.target.closest("input")) return;
      switchSession(el.dataset.id);
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.target.closest("input")) switchSession(el.dataset.id);
    });
  });
  list.querySelectorAll("[data-rename]").forEach(btn => {
    setIcon(btn, "edit");
    btn.addEventListener("click", e => { e.stopPropagation(); startRenameSession(btn.dataset.rename); });
  });
  list.querySelectorAll("[data-download]").forEach(btn => {
    setIcon(btn, "download");
    btn.addEventListener("click", e => { e.stopPropagation(); openDownloadDialog(btn.dataset.download); });
  });
  list.querySelectorAll("[data-del]").forEach(btn => {
    setIcon(btn, "trash");
    bindSessionDeleteConfirm(btn);
  });
  list.querySelectorAll("[data-rename-input]").forEach(input => {
    input.addEventListener("click", e => e.stopPropagation());
    input.focus();
    input.select();
    const commit = () => finishRenameSession(input.dataset.renameInput, input.value);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { state.renamingSessionId = null; renderSessionList(); }
    });
  });
}

function syncUIFromSession() {
  const session = activeSession();
  if (!session) return;
  $("system-prompt").value = session.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  syncModelFromSession(session);
  updateChatTitle();
  updateGrammarUI();
}

function updateGrammarUI() {
  const webOn = webSearchEffective() || state.webSearchPreferred;
  document.querySelectorAll("#grammar-modes .seg-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.grammarMode);
    btn.disabled = webOn && btn.dataset.mode !== "off";
  });
  $("grammar-json-wrap").classList.toggle("show", state.grammarMode === "json" && !webOn);
  $("grammar-ebnf-wrap").classList.toggle("show", state.grammarMode === "ebnf" && !webOn);
  $("max-tokens").value = state.maxNewTokens;
  updateWebSearchUI();
}

function updateWebSearchUI() {
  const toggle = $("web-search-toggle");
  if (!toggle) return;
  toggle.checked = state.webSearchPreferred;
  const def = activeModelDef();
  const canUse = !!def?.supportsTools;
  toggle.disabled = !canUse;
  const help = $("web-search-help");
  const tipEl = $("web-search-help-text");
  if (help && tipEl) {
    let tip = "Enable to let the model search the web via Exa MCP when needed.";
    if (!canUse) {
      tip = "Web search requires Gemma 4 E2B (select in model picker).";
    } else if (state.webSearchPreferred && !state.model) {
      tip = "Load Gemma 4 E2B to use web search. Queries are sent to Exa MCP.";
    } else if (webSearchEffective()) {
      tip = "Web search active. Queries are sent to Exa MCP (third-party). Grammar mode is disabled.";
    }
    tipEl.textContent = tip;
  }
}

function renderChat({ scrollForce = false, animateLast = false } = {}) {
  const session = activeSession();
  const container = $("chat-messages");
  const empty = $("empty-state");
  const wasPinned = isPinnedToBottom(chatScrollEl());
  container.replaceChildren();

  if (!session?.messages.length) {
    empty.style.display = "";
    mountWebGpuBanner();
    updateEmptyLoader();
    return;
  }
  empty.style.display = "none";
  const hasAgentMessages = session.messages.some(
    message => message.role === "tool" || message.tool_calls?.length,
  );
  const appendRendered = (node, messageIndex) => {
    if (!animateLast || messageIndex !== session.messages.length - 1) {
      node.classList.add("no-entry-animation");
    }
    container.appendChild(node);
  };

  for (let i = 0; i < session.messages.length; i++) {
    const msg = session.messages[i];
    if (msg.role === "user") {
      appendRendered(buildUserMessage(msg.content, i), i);
    } else if (hasAgentMessages) {
      for (const step of agentMessagesToSteps([msg])) {
        appendRendered(buildAgentStepMessage(step), i);
      }
    } else if (msg.role === "assistant") {
      appendRendered(buildAssistantMessage(msg), i);
    }
  }
  mountWebGpuBanner();
  scrollChatToBottom(scrollForce, wasPinned);
}

/* ── Streaming ── */

let renderScheduled = false;
/** @type {object|null} */
let renderState = null;
/** @type {object|null} */
let activeStreamCtx = null;
let phasePulseTimer = null;

function stopPhasePulse() {
  if (phasePulseTimer) {
    clearInterval(phasePulseTimer);
    phasePulseTimer = null;
  }
}

function startPhasePulse() {
  stopPhasePulse();
  phasePulseTimer = setInterval(() => {
    if (renderState && (renderState.streamPhase === "searching" || renderState.prefillActive)) {
      scheduleStreamRender();
    } else if (
      activeStreamCtx &&
      (activeStreamCtx.streamPhase === "searching"
        || activeStreamCtx.prefillActive
        || activeStreamCtx.streamPhase === "generating")
    ) {
      scheduleAgentStepsRender(activeStreamCtx);
    } else {
      stopPhasePulse();
    }
  }, 250);
}

function createStreamingMessage() {
  $("empty-state").style.display = "none";
  $("chat-messages").appendChild(buildAssistantMessage(null, { streaming: true }));
  mountWebGpuBanner();
  scrollChatToBottom(true);
}

function scheduleStreamRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (renderState) renderStreamFrame(renderState);
  });
}

/**
 * @param {object} state
 */
function renderStreamFrame(state) {
  const {
    raw = "",
    streamPhase = "generating",
    tracker = null,
    prefillActive = false,
    tokCount = 0,
    tps = 0,
  } = state;

  const msgEl = $("streaming-msg");
  if (!msgEl) return;
  const wasPinned = isPinnedToBottom(chatScrollEl());

  const { thinking, output } = splitThinking(raw);
  const displayThinking = thinking;
  const snap = tracker?.snapshot?.() || {};
  const phaseOpts = {
    streamPhase,
    prefillActive,
    prefillTokens: snap.prefillTokens,
    prefillSec: snap.prefillSec,
    cachedTokens: snap.cachedTokens,
    tokCount,
    tps,
    ttft: snap.ttft,
    displayThinking,
  };
  const activeStatus = formatActivePhaseStatus(phaseOpts);
  const thinkPanelLabel = formatThinkPanelLabel(phaseOpts);

  const disclosure = msgEl.querySelector(".think-disclosure");
  const thinkContent = msgEl.querySelector(".think-content");
  const thinkLabelEl = msgEl.querySelector(".think-label");
  const response = msgEl.querySelector(".response-content");
  const footer = msgEl.querySelector(".stream-footer");
  let stats = msgEl.querySelector(".msg-stats-inline");

  const showThinkPanel = modelSupportsThinking() || displayThinking;
  if (showThinkPanel) {
    if (!disclosure) {
      const card = msgEl.querySelector(".msg-card");
      const disc = buildThinkingDisclosure(displayThinking, null, { streaming: true, open: true });
      if (disc) card.insertBefore(disc, response);
    }
    if (thinkContent) {
      if (streamPhase === "searching") {
        if (displayThinking) {
          if (thinkContent.textContent !== displayThinking) {
            thinkContent.textContent = displayThinking;
          }
        } else if (!thinkContent.querySelector(".thinking-dots")) {
          thinkContent.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
        }
      } else if (displayThinking) {
        if (thinkContent.textContent !== displayThinking) {
          thinkContent.textContent = displayThinking;
        }
      } else if (streamPhase === "prefill" || streamPhase === "generating") {
        if (!thinkContent.querySelector(".thinking-dots")) {
          thinkContent.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
        }
      } else if (!thinkContent.querySelector(".thinking-dots")) {
        thinkContent.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
      }
    }
    if (thinkLabelEl) {
      thinkLabelEl.textContent = thinkPanelLabel;
    }
    const discEl = msgEl.querySelector(".think-disclosure");
    if (discEl) discEl.open = true;
  }

  if (response) {
    setResponseContent(response, output, { streaming: streamPhase === "generating" && !!output });
  }

  if (footer) {
    if (!stats) {
      stats = document.createElement("span");
      stats.className = "msg-stats-inline";
      footer.appendChild(stats);
    }
    stats.textContent = activeStatus;
  }

  msgEl.querySelector(".response-stream-meta")?.remove();

  if (state.busy) setModelStatus("busy", activeStatus);

  scrollChatToBottom(false, wasPinned);
}

function finalizeStreamingMessage(message) {
  stopPhasePulse();
  const next = buildAssistantMessage(message);
  next.classList.add("no-entry-animation");
  const current = $("streaming-msg");
  if (current) current.replaceWith(next);
  else $("chat-messages").appendChild(next);
  renderState = null;
}

/**
 * @param {object} chunk
 * @param {object} ctx
 * @param {{ trackMetrics?: boolean }} [opts]
 */
function handleGenerationChunk(chunk, ctx, { trackMetrics = true } = {}) {
  if (ctx.stopRequested) return;
  if (isPrefillChunk(chunk)) {
    if (trackMetrics) {
      if (chunk.status === "start") ctx.tracker.onPrefillStart(chunk);
      if (chunk.status === "done") ctx.tracker.onPrefillDone(chunk);
    }
    if (chunk.status === "done") {
      ctx.prefillActive = false;
    } else {
      ctx.prefillActive = true;
    }
    ctx.streamPhase = "prefill";
    startPhasePulse();
    return;
  }

  ctx.streamPhase = "generating";
  ctx.prefillActive = false;
  if (trackMetrics) ctx.tracker.onToken();
  ctx.raw = chunk.rawText ?? chunk.text ?? ctx.raw;
  ctx.generatedTokens = trackMetrics
    ? ctx.tracker.generatedTokens
    : Math.max(ctx.generatedTokens + 1, ctx.tracker.generatedTokens);
  const snap = ctx.tracker.snapshot();
  ctx.tps = snap.tps ? Number(snap.tps) : 0;
  startPhasePulse();
}

function initStreamContext() {
  const tracker = new GenerationTracker();
  return {
    tracker,
    raw: "",
    streamPhase: "prefill",
    prefillActive: true,
    searchStartedAt: 0,
    generatedTokens: 0,
    tps: 0,
    stopRequested: false,
  };
}

function publishStreamContext(ctx) {
  renderState = {
    raw: ctx.raw,
    streamPhase: ctx.streamPhase,
    tracker: ctx.tracker,
    prefillActive: ctx.prefillActive,
    tokCount: ctx.generatedTokens,
    tps: ctx.tps,
    busy: true,
  };
  scheduleStreamRender();
}

let activeAgentMessages = [];
let streamingAgentMessage = null;
const activeToolCallIds = new Set();
/** @type {HTMLElement[]} */
let agentStepEls = [];
let agentStepsRenderScheduled = false;

function clearAgentStepsUI() {
  activeAgentMessages = [];
  streamingAgentMessage = null;
  activeToolCallIds.clear();
  agentStepEls = [];
  agentStepsRenderScheduled = false;
}

function buildLiveAgentStepElement(step, streamStatus) {
  const el = buildAgentStepMessage(step, {
    streamStatus: step.streaming ? streamStatus : "",
  });
  el.dataset.agentStepKey = step.key;
  el.classList.add("no-entry-animation");
  return el;
}

function reconcileAgentStepElements(steps, container, streamStatus) {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const current = agentStepEls[index];
    if (current?.dataset.agentStepKey === step.key) continue;

    const existingIndex = agentStepEls.findIndex(
      (el, candidateIndex) =>
        candidateIndex > index && el.dataset.agentStepKey === step.key,
    );
    if (existingIndex >= 0) {
      const [existing] = agentStepEls.splice(existingIndex, 1);
      container.insertBefore(existing, current || null);
      agentStepEls.splice(index, 0, existing);
      continue;
    }

    const next = buildLiveAgentStepElement(step, streamStatus);
    container.insertBefore(next, current || null);
    agentStepEls.splice(index, 0, next);
  }

  for (const stale of agentStepEls.splice(steps.length)) stale.remove();
}

function streamStatusFromContext(ctx) {
  const snap = ctx.tracker?.snapshot?.() || {};
  const { thinking, output } = splitThinking(ctx.raw || "");
  const displayThinking = thinking;
  return formatActivePhaseStatus({
    streamPhase: ctx.streamPhase,
    prefillActive: ctx.prefillActive,
    prefillTokens: snap.prefillTokens,
    prefillSec: snap.prefillSec,
    cachedTokens: snap.cachedTokens,
    searchStartedAt: ctx.searchStartedAt,
    tokCount: ctx.generatedTokens,
    tps: ctx.tps,
    ttft: snap.ttft,
    displayThinking: output ? "" : displayThinking,
  });
}

function syncActiveAgentSteps(ctx) {
  const steps = agentMessagesToSteps(activeAgentMessages, {
    streamingMessage: streamingAgentMessage,
    activeToolCallIds,
    runtimeStatus: {
      active: ctx.streamPhase === "prefill"
        || ctx.streamPhase === "stopping"
        || ctx.prefillActive,
      label: ctx.streamPhase === "stopping" ? "Stopping" : "Prefill",
    },
  });
  const container = $("chat-messages");
  const wasPinned = isPinnedToBottom(chatScrollEl());
  const streamStatus = streamStatusFromContext(ctx);
  reconcileAgentStepElements(steps, container, streamStatus);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!agentStepEls[i]) continue;
    const status = step.streaming ? streamStatus : "";
    if (ctx.busy || step.streaming || agentStepEls[i].classList.contains("streaming")) {
      updateAgentStepElement(agentStepEls[i], step, status);
    }
  }

  scrollChatToBottom(false, wasPinned);
  if (ctx.busy) setModelStatus("busy", streamStatus);
}

function visibleStreamAnswer(raw, output) {
  if (hasUnclosedThoughtChannel(raw)) return "";
  return sanitizeExternalText(output);
}

function shouldStreamAnswer(raw, output) {
  const visible = visibleStreamAnswer(raw, output);
  if (!visible) return false;
  if (looksLikeToolCallSyntax(visible)) return false;
  return true;
}

function updateStreamingAgentMessage(ctx) {
  const raw = ctx.raw || "";
  const split = splitThinking(raw);
  const output = split.output || "";
  const toolish = looksLikeToolCallSyntax(output) || looksLikeToolCallSyntax(raw);
  streamingAgentMessage = {
    role: "assistant",
    content: !toolish && shouldStreamAnswer(raw, output)
      ? visibleStreamAnswer(raw, output)
      : null,
    thinking: split.thinking || "",
  };
  publishAgentStreamContext(ctx);
}

function scheduleAgentStepsRender(ctx) {
  if (agentStepsRenderScheduled) return;
  agentStepsRenderScheduled = true;
  requestAnimationFrame(() => {
    agentStepsRenderScheduled = false;
    syncActiveAgentSteps(ctx);
  });
}

function publishAgentStreamContext(ctx) {
  ctx.busy = true;
  scheduleAgentStepsRender(ctx);
}

function stopActiveGeneration() {
  if (!state.abort || state.abort.signal.aborted) return;
  state.abort.abort();
  if (activeStreamCtx) {
    activeStreamCtx.stopRequested = true;
    activeStreamCtx.streamPhase = "stopping";
    activeStreamCtx.prefillActive = false;
    activeStreamCtx.busy = true;
    if (agentStepEls.length || webSearchEffective()) {
      publishAgentStreamContext(activeStreamCtx);
    } else {
      publishStreamContext(activeStreamCtx);
    }
  }
  setModelStatus("busy", "Stopping…");
  updateComposerState();
}

/* ── Copy handler: wired on each button via createCopyButton / performCopy ── */

/* ── Send ── */

async function switchSession(id) {
  if (state.busy || state.loading) {
    toast("Wait until the current operation finishes.");
    return;
  }
  if (id === state.activeSessionId) {
    $("sidebar").classList.remove("open");
    focusComposerInput($("user-input"));
    return;
  }
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  state.activeSessionId = id;
  savePrefs();
  renderSessionList();
  renderChat();
  syncUIFromSession();
  focusComposerInput($("user-input"));
  const modelId = resolveModelIdForSession(session, state.selectedModelId);
  if (!session.modelId) await patchSessionFields(session, { modelId });
  await applyModelSelection(modelId, { silent: true, persistToSession: false });
  resetLoadedModel();
  $("sidebar").classList.remove("open");
  focusComposerInput($("user-input"));
}

async function runAssistantGeneration(session) {
  state.busy = true;
  chatScrollEl().classList.add("streaming-scroll");
  state.abort = new AbortController();
  updateComposerState();
  setModelStatus("busy", "Starting…");

  const useAgent = webSearchEffective();
  /** @type {ReturnType<typeof initStreamContext>} */
  let streamCtx = initStreamContext();
  activeStreamCtx = streamCtx;

  if (useAgent) {
    $("empty-state").style.display = "none";
    clearAgentStepsUI();
    mountWebGpuBanner();
  } else {
    createStreamingMessage();
    publishStreamContext(streamCtx);
  }

  let raw = "";
  let thinking = "";
  let output = "";
  /** @type {object|null} */
  let finalMetrics = null;
  let result = null;
  let generationError = null;

  try {
    if (useAgent) {
      const webSearchTool = createWebSearchTool(defaultSearchProvider);
      const baseMessages = buildAgentMessages(session, [webSearchTool]);
      result = await runAgentTurn({
        model: state.model,
        messages: baseMessages,
        tools: [webSearchTool],
        generateFn: generateGemmaAssistant,
        maxNewTokens: state.maxNewTokens,
        contextWindowTokens: loadedModelDef()?.contextWindowTokens,
        signal: state.abort.signal,
        callIdPrefix: `${session.id || "session"}_${session.messages.length - 1}`,
        getTracker: () => streamCtx.tracker,
        onStream: (chunk) => {
          handleGenerationChunk(chunk, streamCtx, { trackMetrics: false });
          updateStreamingAgentMessage(streamCtx);
        },
        onEvent: (event) => {
          if (event.type === "generation_start") {
            streamingAgentMessage = null;
            streamCtx.tracker = new GenerationTracker();
            streamCtx.streamPhase = "prefill";
            streamCtx.prefillActive = true;
            streamCtx.raw = "";
            streamCtx.generatedTokens = 0;
            publishAgentStreamContext(streamCtx);
          } else if (event.type === "message_end") {
            streamingAgentMessage = null;
            activeAgentMessages.push(event.message);
            publishAgentStreamContext(streamCtx);
          } else if (event.type === "tool_start") {
            activeToolCallIds.add(event.toolCall.id);
            streamCtx.streamPhase = "searching";
            streamCtx.searchStartedAt = performance.now();
            streamCtx.prefillActive = false;
            startPhasePulse();
            publishAgentStreamContext(streamCtx);
          } else if (event.type === "tool_end") {
            activeToolCallIds.delete(event.toolCall.id);
            activeAgentMessages.push(event.message);
            streamCtx.streamPhase = "prefill";
            streamCtx.prefillActive = true;
            streamCtx.raw = "";
            publishAgentStreamContext(streamCtx);
          }
        },
      });
      raw = result.raw || streamCtx.raw;
      output = result.content || "";
      finalMetrics = result.metrics || streamCtx.tracker.snapshot();
      if (result.aborted) {
        const split = splitThinking(raw);
        thinking = split.thinking || result.thinking || "";
        output = split.output || output;
      }
    } else {
      const modelDef = loadedModelDef();
      const enableThinking = modelSupportsThinking();
      const runtimeMessages = buildMessages(session);
      const fittedMessages = fitMessagesToContext(runtimeMessages, {
        contextWindowTokens: modelDef?.contextWindowTokens,
        maxNewTokens: state.maxNewTokens,
        countTokens: messages => {
          if (modelDef?.runtime === "gemma") {
            return countGemmaPromptTokens(state.model, messages, {
              enableThinking,
            });
          }
          if (typeof state.model.encodePrompt !== "function") return null;
          return state.model.encodePrompt(messages).length;
        },
      });
      const stream = state.model.generate(fittedMessages, {
        maxNewTokens: state.maxNewTokens,
        enableThinking,
        signal: state.abort.signal,
      });
      for await (const chunk of stream) {
        handleGenerationChunk(chunk, streamCtx);
        publishStreamContext(streamCtx);
      }
      raw = streamCtx.raw;
      finalMetrics = streamCtx.tracker.snapshot();
      const split = splitThinking(raw);
      thinking = split.thinking;
      output = split.output;
    }
  } catch (err) {
    console.error(err);
    generationError = err instanceof Error ? err.message : String(err);
    const fallback = generationErrorFallback(err, { raw: streamCtx.raw || raw });
    raw = fallback.raw;
    if (fallback.toast) toast(fallback.toast);
    const split = splitThinking(raw);
    thinking = split.thinking;
    output = split.output;
  } finally {
    stopPhasePulse();
    finalMetrics = finalMetrics || streamCtx.tracker.snapshot();
    const meta = {
      tokens: finalMetrics?.tokens ?? streamCtx.generatedTokens,
      tps: finalMetrics?.tps ?? "0",
      ttft: finalMetrics?.ttft ?? "0",
      prefillSec: finalMetrics?.prefillSec ?? null,
      prefillTokens: finalMetrics?.prefillTokens ?? 0,
      cachedTokens: finalMetrics?.cachedTokens ?? 0,
    };
    if (!useAgent) {
      const split = splitThinking(raw);
      thinking = split.thinking;
      output = split.output;
      if (looksLikeToolCallSyntax(output || raw)) {
        const cleaned = stripToolCallSyntax(output || raw);
        toast("Enable Web Search in the composer to run tool calls.");
        if (cleaned) output = cleaned;
        else {
          output = "The model tried to run a web search. Turn on Web Search and try again.";
        }
      }
    }
    let finalAssistantMessage = null;
    const wasAborted = !!(state.abort?.signal.aborted || result?.aborted);
    if (useAgent && result?.newMessages?.length) {
      session.messages.push(...result.newMessages);
    } else {
      finalAssistantMessage = {
        role: "assistant",
        content: output || raw || (wasAborted ? "(stopped)" : "(no output)"),
        thinking: thinking || "",
        meta,
      };
      session.messages.push(finalAssistantMessage);
      if (useAgent) activeAgentMessages.push(finalAssistantMessage);
    }
    session.lastExecution = {
      mode: useAgent ? "agent" : "chat",
      tools: useAgent ? ["web_search"] : [],
      generations: result?.generations ?? 1,
      toolCalls: result?.toolCalls ?? 0,
      aborted: wasAborted,
      error: generationError,
      completedAt: Date.now(),
    };
    try {
      await persistSession(session);
    } catch (err) {
      console.error(err);
      toast("The reply could not be persisted, but it remains visible in this chat.");
    } finally {
      state.busy = false;
      state.abort = null;
      streamCtx.busy = false;
      streamCtx.streamPhase = "done";
      streamCtx.prefillActive = false;
      if (useAgent) {
        syncActiveAgentSteps(streamCtx);
        clearAgentStepsUI();
      } else {
        finalizeStreamingMessage(finalAssistantMessage);
      }
      activeStreamCtx = null;
      renderState = null;
      chatScrollEl().classList.remove("streaming-scroll");
      restoreIdleStatus();
      updateComposerState();
      flushQueuedDownload();
    }
  }
}

async function sendMessage() {
  const input = $("user-input");
  const text = input.value.trim();
  const session = activeSession();
  const expectedModelId = resolveModelIdForSession(session, state.selectedModelId);
  const sendCheck = canSendToModel({
    text,
    model: state.model,
    busy: state.busy,
    loadedModelId: state.loadedModelId,
    expectedModelId,
  });
  if (!sendCheck.ok) {
    if (sendCheck.reason === "model_mismatch") {
      toast(`Load ${modelLabel(expectedModelId)} before sending in this chat.`);
    }
    return;
  }
  if (!session) return;
  state.busy = true;
  updateComposerState();
  session.systemPrompt = $("system-prompt").value;
  if (!session.modelId) session.modelId = state.selectedModelId;
  session.messages.push({ role: "user", content: text });
  if (session.messages.length === 1) session.title = firstMessageTitle(text);
  try {
    await persistSession(session);
  } catch (err) {
    console.error(err);
    state.busy = false;
    updateComposerState();
    flushQueuedDownload();
    toast("Could not save the message.");
    return;
  }

  input.value = "";
  input.style.height = "auto";
  renderChat({ scrollForce: true, animateLast: true });

  await runAssistantGeneration(session);
}

/* ── Init ── */

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function initStaticIcons() {
  setIcon($("brand-icon"), "webllm");
  setIcon($("empty-icon"), "webllm");
  setIcon($("sidebar-toggle"), "menu");
  setIcon($("chat-title-edit"), "edit");
  setIcon($("send-btn"), "send");
  setIcon($("credits-dialog-close"), "close");
  setIcon($("download-dialog-close"), "close");
  const newBtn = $("new-chat-btn");
  newBtn.append(icon("plus"), document.createTextNode(" New conversation"));
  const versionEl = $("app-version");
  if (versionEl) {
    versionEl.setAttribute("aria-label", `App version ${APP_VERSION}`);
    versionEl.innerHTML = `<span class="version-label">Version</span><span class="version-num">${APP_VERSION}</span>`;
  }
}

async function init() {
  initStaticIcons();
  initTheme();

  try {
    state.db = await openDB();
    state.sessions = (await dbGetAll(state.db))
      .map(record => normalizeSessionRecord(record, MODELS))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error(err);
    disableSessionPersistence(err);
    state.sessions = [];
  }

  loadPrefs();
  updateGrammarUI();
  updateWebSearchUI();
  if (!state.sessions.length) await createSession();
  else if (!state.activeSessionId || !state.sessions.find(s => s.id === state.activeSessionId)) {
    state.activeSessionId = state.sessions[0].id;
  }

  renderSessionList();
  renderChat();
  syncUIFromSession();
  const bootSession = activeSession();
  if (bootSession && !sessionModelId(bootSession)) {
    await patchSessionFields(bootSession, { modelId: state.selectedModelId });
  }
  updateComposerState();

  if (state.fileOrigin) $("file-origin-note").hidden = false;

  await probeWebGPU();
  await repairBrokenModelCacheLocal();
  await refreshStorageUI();
}

$("theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
$("load-model-btn").addEventListener("click", loadModel);
$("load-model-btn-hero").addEventListener("click", loadModel);
$("new-chat-btn").addEventListener("click", async () => {
  focusComposerInput($("user-input"));
  const session = await createSession();
  if (!session) return;
  renderChat();
  syncUIFromSession();
  resetLoadedModel();
  focusComposerInput($("user-input"));
});
$("model-picker").addEventListener("change", e => {
  const input = e.target.closest('input[name="model-id"]');
  if (input?.checked) selectModel(input.value);
});
$("sidebar-toggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
$("chat-title").addEventListener("dblclick", startRenameActiveChat);
$("chat-title-edit").addEventListener("click", startRenameActiveChat);
$("session-search").addEventListener("input", () => {
  state.sessionSearch = $("session-search").value;
  renderSessionList();
  savePrefs();
});

document.querySelectorAll("#grammar-modes .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (webSearchEffective() || state.webSearchPreferred) {
      if (btn.dataset.mode !== "off") {
        toast("Disable web search to use grammar mode.");
        return;
      }
    }
    state.grammarMode = btn.dataset.mode;
    savePrefs();
    updateGrammarUI();
  });
});

$("web-search-toggle")?.addEventListener("change", () => {
  state.webSearchPreferred = $("web-search-toggle").checked;
  if (state.webSearchPreferred && state.grammarMode !== "off") {
    state.grammarMode = "off";
    toast("Grammar mode disabled while web search is on.");
  }
  savePrefs();
  updateGrammarUI();
});

const debounce = createDebouncer();

$("system-prompt").addEventListener("input", () => debounce("system-prompt", async () => {
  const s = activeSession(); if (!s) return;
  s.systemPrompt = $("system-prompt").value;
  await persistSession(s);
}));

for (const id of ["grammar-json-schema", "grammar-custom"]) {
  $(id).addEventListener("input", () => debounce(id, savePrefs));
}

$("max-tokens").addEventListener("change", () => {
  state.maxNewTokens = clampMaxNewTokens($("max-tokens").value);
  $("max-tokens").value = state.maxNewTokens;
  savePrefs();
});

$("clear-model-cache-btn").addEventListener("click", () => clearModelCache());

for (const id of ["conversations-block", "model-block", "system-block", "settings-block", "storage-block"]) {
  $(id).addEventListener("toggle", savePrefs);
}

$("credits-btn").addEventListener("click", () => $("credits-dialog").showModal());
$("credits-dialog-close").addEventListener("click", () => $("credits-dialog").close());
$("credits-dialog").addEventListener("click", e => {
  if (e.target === $("credits-dialog")) $("credits-dialog").close();
});
$("download-dialog-close").addEventListener("click", closeDownloadDialog);
$("download-cancel-btn").addEventListener("click", closeDownloadDialog);
$("download-confirm-btn").addEventListener("click", confirmDownload);
$("download-dialog").addEventListener("click", e => {
  if (e.target === $("download-dialog")) closeDownloadDialog();
});
$("download-dialog").addEventListener("close", () => {
  pendingDownloadSessionId = null;
});

$("send-btn").addEventListener("click", sendMessage);
$("stop-btn").addEventListener("click", stopActiveGeneration);
$("user-input").addEventListener("input", () => autoResizeTextarea($("user-input")));
$("user-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

init().catch(err => {
  console.error("WebLLM initialization failed.", err);
  state.loading = false;
  state.busy = false;
  updateComposerState();
  toast("The app could not finish initializing. You can still retry loading the model.");
});
