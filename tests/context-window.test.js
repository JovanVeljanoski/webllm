import { describe, expect, it } from "vitest";
import {
  capMaxNewTokensForContext,
  effectiveMaxNewTokens,
  fitMessagesToContext,
} from "../lib/context-window.js";
import { MODELS } from "../lib/models.js";

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

  it("caps maxNewTokens so a 4K window still leaves prompt space", () => {
    expect(capMaxNewTokensForContext(4096, 4096)).toBe(3328);
    const messages = [
      { role: "system", content: "x".repeat(20) },
      { role: "user", content: "x".repeat(30) },
    ];
    expect(fitMessagesToContext(messages, {
      contextWindowTokens: 4096,
      maxNewTokens: 4096,
      countTokens,
    })).toBe(messages);
  });

  it("allows a tool-heavy single turn even when maxNewTokens reserves only 512 input", () => {
    const messages = [
      { role: "system", content: "x".repeat(500) },
      { role: "user", content: "x".repeat(200) },
    ];
    expect(() => fitMessagesToContext(messages, {
      contextWindowTokens: 4096,
      maxNewTokens: 4096,
      countTokens,
    })).not.toThrow();
  });

  it("applies per-model default max-new-tokens after the context cap", () => {
    expect(effectiveMaxNewTokens(4096, MODELS.bonsai27b)).toBe(1024);
    expect(effectiveMaxNewTokens(4096, MODELS.gemma4)).toBe(4096);
  });
});
