import { describe, expect, it } from "vitest";
import { buildPrefsPayload, parsePrefsJson } from "../lib/prefs.js";

describe("prefs", () => {
  it("serializes and parses round-trip payloads", () => {
    const input = {
      activeSessionId: "s1",
      selectedModelId: "lfm2",
      grammarMode: "json",
      maxNewTokens: 2048,
      grammarJsonSchema: "{}",
      grammarEbnf: "",
      sessionSearch: "hello",
      sidebarOpen: { model: true },
    };
    const payload = buildPrefsPayload(input);
    const parsed = parsePrefsJson(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
  });

  it("returns empty object for invalid JSON", () => {
    expect(parsePrefsJson("{not json")).toEqual({});
    expect(parsePrefsJson("")).toEqual({});
  });
});
