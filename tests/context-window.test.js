import { describe, expect, it } from "vitest";
import { fitMessagesToContext } from "../lib/context-window.js";

const countTokens = messages =>
  messages.reduce((sum, message) => sum + String(message.content || "").length, 0);

describe("fitMessagesToContext", () => {
  it("keeps the complete transcript when it fits the model token budget", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "question" },
    ];
    expect(fitMessagesToContext(messages, {
      contextWindowTokens: 100,
      maxNewTokens: 10,
      safetyTokens: 0,
      countTokens,
    })).toBe(messages);
  });

  it("drops only complete oldest turns based on exact token counts", () => {
    const recentTurn = [
      { role: "user", content: "recent" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
      { role: "tool", content: "full result", tool_call_id: "c1" },
    ];
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      ...recentTurn,
    ];

    expect(fitMessagesToContext(messages, {
      contextWindowTokens: 30,
      maxNewTokens: 5,
      safetyTokens: 0,
      countTokens,
    })).toEqual([{ role: "system", content: "sys" }, ...recentTurn]);
  });

  it("does not truncate an oversized current turn", () => {
    expect(() => fitMessagesToContext([
      { role: "system", content: "sys" },
      { role: "user", content: "x".repeat(50) },
    ], {
      contextWindowTokens: 40,
      maxNewTokens: 5,
      safetyTokens: 0,
      countTokens,
    })).toThrow(/current turn requires 53 input tokens/i);
  });
});
