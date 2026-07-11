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
    return { ...p, webSearchPreferred: p.webSearchPreferred === true };
  } catch {
    return { webSearchPreferred: false };
  }
}
