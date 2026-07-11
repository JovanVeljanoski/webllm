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
      webSearchPreferred: true,
    };
    const payload = buildPrefsPayload(input);
    const parsed = parsePrefsJson(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
    expect(parsed.webSearchPreferred).toBe(true);
  });

  it("defaults webSearchPreferred to false", () => {
    const payload = buildPrefsPayload({
      activeSessionId: null,
      selectedModelId: "gemma4",
      grammarMode: "off",
      maxNewTokens: 512,
    });
    expect(payload.webSearchPreferred).toBe(false);
  });

  it("returns safe defaults for invalid or empty JSON", () => {
    expect(parsePrefsJson("{not json")).toEqual({ webSearchPreferred: false });
    expect(parsePrefsJson("")).toEqual({ webSearchPreferred: false });
  });

  it("treats missing webSearchPreferred as false", () => {
    const parsed = parsePrefsJson(JSON.stringify({ selectedModelId: "gemma4" }));
    expect(parsed.webSearchPreferred).toBe(false);
  });
});
