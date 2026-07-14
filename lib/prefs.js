/** @file Preferences serialize/parse. */

export function buildPrefsPayload({
  activeSessionId,
  selectedModelId,
  grammarMode,
  maxNewTokens,
  grammarJsonSchema,
  grammarEbnf,
  sessionSearch,
  sidebarOpen,
  webSearchPreferred,
}) {
  return {
    activeSessionId,
    selectedModelId,
    grammarMode,
    maxNewTokens,
    grammarJsonSchema: grammarJsonSchema || "",
    grammarEbnf: grammarEbnf || "",
    sessionSearch: sessionSearch || "",
    sidebarOpen: sidebarOpen || {},
    webSearchPreferred: !!webSearchPreferred,
  };
}

export function parsePrefsJson(raw) {
  if (!raw) return { webSearchPreferred: false };
  try {
    const p = JSON.parse(raw);
    if (typeof p !== "object" || p === null) return { webSearchPreferred: false };
    const out = { webSearchPreferred: p.webSearchPreferred === true };
    if (typeof p.activeSessionId === "string") out.activeSessionId = p.activeSessionId.slice(0, 200);
    if (typeof p.selectedModelId === "string") out.selectedModelId = p.selectedModelId;
    if (["off", "json", "ebnf"].includes(p.grammarMode)) out.grammarMode = p.grammarMode;
    if (typeof p.maxNewTokens === "number" && Number.isFinite(p.maxNewTokens)) {
      out.maxNewTokens = Math.round(p.maxNewTokens);
    }
    if (typeof p.grammarJsonSchema === "string") out.grammarJsonSchema = p.grammarJsonSchema.slice(0, 20_000);
    if (typeof p.grammarEbnf === "string") out.grammarEbnf = p.grammarEbnf.slice(0, 20_000);
    if (typeof p.sessionSearch === "string") out.sessionSearch = p.sessionSearch.slice(0, 200);
    if (p.sidebarOpen && typeof p.sidebarOpen === "object" && !Array.isArray(p.sidebarOpen)) {
      out.sidebarOpen = { ...p.sidebarOpen };
    }
    return out;
  } catch {
    return { webSearchPreferred: false };
  }
}
