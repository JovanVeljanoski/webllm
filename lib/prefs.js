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
  };
}

export function parsePrefsJson(raw) {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === "object" && p !== null ? p : {};
  } catch {
    return {};
  }
}
