import { describe, expect, it } from "vitest";
import { sanitizeExternalText } from "../lib/sanitize.js";

describe("sanitizeExternalText", () => {
  it("removes Gemma control tokens", () => {
    const dirty = "Hello <|tool_call>web_search{}<tool_call|> <|channel>thought\nx";
    expect(sanitizeExternalText(dirty)).toBe("Hello web_search{} thought\nx");
  });

  it("returns empty for falsy input", () => {
    expect(sanitizeExternalText("")).toBe("");
    expect(sanitizeExternalText(null)).toBe("");
  });
});
