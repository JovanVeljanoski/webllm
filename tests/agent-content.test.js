import { describe, expect, it } from "vitest";
import {
  looksLikeClarificationOnly,
  safeAssistantContent,
} from "../lib/agent-content.js";

describe("agent-content", () => {
  it("detects clarification-only answers", () => {
    expect(looksLikeClarificationOnly("Please tell me what sport or league you mean?")).toBe(true);
    expect(looksLikeClarificationOnly("Spain beat Belgium 2-1 in the semifinal.")).toBe(false);
  });

  it("strips unsafe assistant content", () => {
    expect(safeAssistantContent('<|tool_call|>call:web_search{query:"x"}')).toBe("");
    expect(safeAssistantContent("[1] Doc\nURL: https://x.test\nsnippet")).toBe("");
    expect(safeAssistantContent("A grounded summary.")).toBe("A grounded summary.");
  });
});
