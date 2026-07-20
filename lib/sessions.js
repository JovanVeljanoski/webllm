/** @file Session list helpers and session record factories. */

import { DEFAULT_MODEL_ID, DEFAULT_SYSTEM_PROMPT } from "./constants.js";
import { isValidModelId } from "./models.js";

export const DEFAULT_TOOL_PREFERENCES = Object.freeze({
  read: false,
  grep: false,
  web_search: false,
});

export function normalizeToolPreferences(value, legacy = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    read: Object.hasOwn(source, "read")
      ? source.read === true
      : legacy.readFilesPreferred === true,
    grep: Object.hasOwn(source, "grep")
      ? source.grep === true
      : legacy.grepFilesPreferred === true,
    web_search: Object.hasOwn(source, "web_search")
      ? source.web_search === true
      : legacy.webSearchPreferred === true,
  };
}

export function sessionDateGroup(ts, now = new Date()) {
  const timestamp = toTimestamp(ts);
  if (timestamp == null) return "Older";
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday.getTime() - 86400000);
  const startWeek = new Date(startToday.getTime() - 6 * 86400000);
  if (timestamp >= startToday.getTime()) return "Today";
  if (timestamp >= startYesterday.getTime()) return "Yesterday";
  if (timestamp >= startWeek.getTime()) return "Previous 7 days";
  return "Older";
}

export function filterSessions(sessions, query = "") {
  const q = String(query || "").trim().toLowerCase();
  return (sessions || []).filter(s => !q || String(s?.title || "").toLowerCase().includes(q));
}

export function sortSessionsByUpdatedAt(sessions) {
  return [...(sessions || [])].sort((a, b) => (
    (toTimestamp(b?.updatedAt) ?? 0) - (toTimestamp(a?.updatedAt) ?? 0)
  ));
}

export function upsertSessionInList(sessions, session) {
  const next = [...sessions];
  const idx = next.findIndex(s => s.id === session.id);
  if (idx >= 0) next[idx] = session;
  else next.unshift(session);
  return sortSessionsByUpdatedAt(next);
}

export function createSessionRecord({
  id,
  title = "New chat",
  modelId,
  selectedModelId,
  toolPreferences,
  webSearchPreferred,
  readFilesPreferred = false,
  grepFilesPreferred = false,
  now = Date.now(),
  models,
}) {
  const resolvedModelId = isValidModelId(modelId, models)
    ? modelId
    : (isValidModelId(selectedModelId, models) ? selectedModelId : DEFAULT_MODEL_ID);
  const timestamp = toTimestamp(now) ?? Date.now();
  const session = {
    id,
    title: normalizeSessionTitle(title),
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    messages: [],
    modelId: resolvedModelId,
    toolPreferences: normalizeToolPreferences(toolPreferences, {
      webSearchPreferred,
      readFilesPreferred,
      grepFilesPreferred,
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return session;
}

export function firstMessageTitle(text, maxLen = 50) {
  const value = String(text || "");
  return value.slice(0, maxLen) + (value.length > maxLen ? "…" : "");
}

export function normalizeSessionTitle(title) {
  return (title || "").trim() || "Untitled";
}

export function canSendToModel({ text, busy, model, loadedModelId, expectedModelId }) {
  if (!text?.trim() || !model || busy) return { ok: false, reason: "busy_or_empty" };
  if (loadedModelId !== expectedModelId) {
    return { ok: false, reason: "model_mismatch" };
  }
  return { ok: true };
}

/** @param {object} session @param {number} messageIndex */
export function truncateSessionMessagesAfterIndex(session, messageIndex) {
  if (!session?.messages?.length) return session;
  const idx = Math.max(0, Math.min(messageIndex, session.messages.length - 1));
  return { ...session, messages: session.messages.slice(0, idx + 1) };
}

/** @param {object} session @param {number} messageIndex @param {string} content */
export function updateUserMessageAtIndex(session, messageIndex, content, {
  fileRefs,
} = {}) {
  const trimmed = (content || "").trim();
  if (!trimmed) return null;
  const messages = [...session.messages];
  const msg = messages[messageIndex];
  if (!msg || msg.role !== "user") return null;
  const updated = { ...msg, content: trimmed };
  if (Array.isArray(fileRefs)) {
    const normalizedRefs = [...new Set(
      fileRefs.map(String).map(value => value.trim()).filter(Boolean),
    )];
    if (normalizedRefs.length) updated.fileRefs = normalizedRefs;
    else delete updated.fileRefs;
  }
  messages[messageIndex] = updated;
  const next = { ...session, messages };
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (messageIndex === firstUserIdx) {
    next.title = firstMessageTitle(trimmed);
  }
  return next;
}

/** @param {object} session */
export function lastUserMessageContent(session) {
  const messages = session?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return String(messages[i].content || "");
  }
  return "";
}

/** @param {object} session @param {number} messageIndex */
export function canRegenerateFromUserMessage(session, messageIndex) {
  const msg = session?.messages?.[messageIndex];
  return !!msg && msg.role === "user";
}

export const SESSION_GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

/**
 * Normalize records written by older app versions before they reach the UI.
 *
 * @param {object} record
 * @param {object} [models]
 * @returns {object|null}
 */
export function normalizeSessionRecord(record, models) {
  if (!record || typeof record !== "object" || !record.id) return null;
  const createdAt = toTimestamp(record.createdAt) ?? toTimestamp(record.updatedAt) ?? Date.now();
  const updatedAt = toTimestamp(record.updatedAt) ?? createdAt;
  const messages = normalizeMessages(record.messages);
  const resolvedModelId = isValidModelId(record.modelId, models)
    ? record.modelId
    : DEFAULT_MODEL_ID;
  const session = {
    ...record,
    id: String(record.id),
    title: normalizeSessionTitle(record.title),
    systemPrompt: String(record.systemPrompt || DEFAULT_SYSTEM_PROMPT),
    messages,
    modelId: resolvedModelId,
    createdAt,
    updatedAt,
  };
  session.toolPreferences = normalizeToolPreferences(record.toolPreferences, record);
  delete session.webSearchPreferred;
  delete session.readFilesPreferred;
  delete session.grepFilesPreferred;
  return session;
}

/**
 * Normalize current messages and flatten the older assistant-embedded tool
 * transcript into one chronological message list.
 *
 * @param {unknown} input
 * @returns {object[]}
 */
export function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const usedCallIds = new Set();
  const currentCallIds = new Map();

  for (let messageIndex = 0; messageIndex < input.length; messageIndex++) {
    const message = input[messageIndex];
    if (!message || typeof message !== "object") continue;

    if (message.role === "user") {
      const normalized = { role: "user", content: String(message.content || "") };
      if (Array.isArray(message.fileRefs)) {
        const fileRefs = [...new Set(
          message.fileRefs.map(String).map(value => value.trim()).filter(Boolean),
        )];
        if (fileRefs.length) normalized.fileRefs = fileRefs;
      }
      out.push(normalized);
      continue;
    }
    if (message.role === "tool") {
      if (!message.tool_call_id) continue;
      out.push({
        ...message,
        role: "tool",
        tool_call_id: currentCallIds.get(String(message.tool_call_id))
          || String(message.tool_call_id),
        content: String(message.content || ""),
      });
      continue;
    }
    if (message.role !== "assistant") continue;

    if (Array.isArray(message.toolTranscript) && message.toolTranscript.length) {
      appendLegacyAssistantTurn(out, message, messageIndex, usedCallIds);
      continue;
    }

    const normalized = normalizeAssistantMessage(message, usedCallIds, messageIndex);
    if (normalized) {
      for (let i = 0; i < (message.tool_calls || []).length; i++) {
        const oldId = String(message.tool_calls[i]?.id || "");
        const newId = normalized.tool_calls?.[i]?.id;
        if (oldId && newId) currentCallIds.set(oldId, newId);
      }
      out.push(normalized);
    }
  }
  return out;
}

function normalizeAssistantMessage(message, usedCallIds, messageIndex) {
  const normalized = {
    role: "assistant",
    content: message.content == null ? null : String(message.content),
  };
  if (message.thinking) normalized.thinking = String(message.thinking);
  if (message.meta) normalized.meta = message.meta;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    normalized.tool_calls = message.tool_calls
      .filter(call => call?.function?.name)
      .map((call, callIndex) => {
        const originalId = String(call.id || `call_${messageIndex}_${callIndex}`);
        let id = originalId;
        let suffix = 1;
        while (usedCallIds.has(id)) id = `${originalId}_${suffix++}`;
        usedCallIds.add(id);
        return {
          id,
          type: "function",
          function: {
            name: String(call.function.name),
            arguments: typeof call.function.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function.arguments || {}),
          },
        };
      });
  }
  return normalized;
}

function appendLegacyAssistantTurn(out, message, messageIndex, usedCallIds) {
  const thinkingSteps = (message.agentSteps || []).filter(step => step?.type === "thinking");
  const resultSteps = (message.agentSteps || []).filter(step => step?.type === "tool_result");
  const traces = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const idMap = new Map();
  let callIndex = 0;
  let resultIndex = 0;

  for (const transcriptMessage of message.toolTranscript) {
    if (transcriptMessage?.role === "assistant" && Array.isArray(transcriptMessage.tool_calls)) {
      const normalized = normalizeAssistantMessage({
        ...transcriptMessage,
        thinking: thinkingSteps[callIndex]?.thinking || "",
      }, usedCallIds, messageIndex);
      for (let i = 0; i < transcriptMessage.tool_calls.length; i++) {
        const oldId = String(transcriptMessage.tool_calls[i]?.id || "");
        const newId = normalized?.tool_calls?.[i]?.id;
        if (oldId && newId) idMap.set(oldId, newId);
      }
      if (normalized) out.push(normalized);
      callIndex++;
    } else if (transcriptMessage?.role === "tool" && transcriptMessage.tool_call_id) {
      const step = resultSteps[resultIndex] || {};
      const trace = traces[resultIndex] || {};
      out.push({
        role: "tool",
        tool_call_id: idMap.get(String(transcriptMessage.tool_call_id))
          || String(transcriptMessage.tool_call_id),
        content: String(transcriptMessage.content || ""),
        meta: {
          query: step.query || trace.query || "",
          queries: trace.queries,
          provider: trace.provider,
          resultCount: step.resultCount ?? trace.resultCount,
          status: step.status || trace.status,
          durationMs: trace.durationMs,
        },
      });
      resultIndex++;
    }
  }

  const finalThinking = thinkingSteps[callIndex]?.thinking
    || (!callIndex ? message.thinking : "");
  const final = normalizeAssistantMessage({
    role: "assistant",
    content: message.content,
    thinking: finalThinking,
    meta: message.meta,
  }, usedCallIds, messageIndex);
  if (final) out.push(final);
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toTimestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
