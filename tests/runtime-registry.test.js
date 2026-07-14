import { describe, expect, it, vi } from "vitest";
import { getRuntimeAdapter } from "../lib/runtime-registry.js";

describe("runtime registry", () => {
  it("exposes protocol and generation behavior by runtime", () => {
    const gemma = getRuntimeAdapter("gemma");
    const lfm = getRuntimeAdapter("lfm2");

    expect(gemma.toolProtocol).toContain("<|tool_call>");
    expect(lfm.toolProtocol).toContain("<|tool_call_start|>");
    expect(gemma.generateAgent).toBeTypeOf("function");
    expect(lfm.generateAgent).toBeTypeOf("function");
  });

  it("centralizes runtime-specific chat options and token counting", () => {
    const encodePrompt = vi.fn(() => [1, 2, 3]);
    const lfm = getRuntimeAdapter("lfm2");

    expect(lfm.countPromptTokens({ encodePrompt }, [])).toBe(3);
    expect(lfm.chatOptions({
      maxNewTokens: 10,
      enableThinking: true,
      signal: "signal",
    })).toEqual({ maxNewTokens: 10, signal: "signal" });
  });

  it("rejects undeclared runtimes", () => {
    expect(() => getRuntimeAdapter("unknown"))
      .toThrow("Unsupported model runtime");
  });
});
