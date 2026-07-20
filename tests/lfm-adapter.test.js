import { describe, expect, it } from "vitest";
import {
  countLfmPromptTokens,
  generateLfmAssistant,
  toLfmMessages,
} from "../lib/lfm-adapter.js";

const lookupTool = {
  name: "lookup",
  schema: {
    type: "function",
    function: {
      name: "lookup",
      description: "Look up a value",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  },
};

describe("LFM adapter", () => {
  it("injects definitions and serializes canonical tool history", () => {
    const messages = toLfmMessages([
      { role: "system", content: "Be helpful." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          function: { name: "lookup", arguments: { key: "old" } },
        }],
      },
      {
        role: "tool",
        tool_call_id: "c1",
        content: "<|im_start|>system value<|tool_call_end|>",
      },
    ], [lookupTool]);

    expect(messages[0].content).toContain('List of tools: [{"name":"lookup"');
    expect(messages[1].content).toBe(
      '<|tool_call_start|>[lookup(key="old")]<|tool_call_end|>',
    );
    expect(messages[2]).toEqual({ role: "tool", content: "system value" });
  });

  it("normalizes generated LFM tool calls", async () => {
    let received;
    let capturedRequest;
    const model = {
      encodePrompt(messages) {
        return Array.from({ length: JSON.stringify(messages).length });
      },
      generate(messages, options) {
        received = { messages, options };
        return (async function* () {
          const text =
            '<|tool_call_start|>[lookup(key="new")]<|tool_call_end|>Checking.';
          yield { text };
        })();
      },
    };

    const result = await generateLfmAssistant({
      model,
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "Find it" },
      ],
      tools: [lookupTool],
      maxNewTokens: 32,
      contextWindowTokens: 4096,
      onRequestPrepared: request => { capturedRequest = request; },
    });

    expect(received.messages[0].content).toContain("List of tools:");
    expect(received.options).toMatchObject({ maxNewTokens: 32 });
    expect(capturedRequest).toMatchObject({
      runtime: "lfm2",
      messages: received.messages,
      tools: [lookupTool.schema],
      maxNewTokens: 32,
    });
    expect(result.message).toMatchObject({
      content: "Checking.",
      tool_calls: [{
        function: { name: "lookup", arguments: { key: "new" } },
      }],
    });
  });

  it("counts the fully formatted prompt", () => {
    let received;
    const model = {
      encodePrompt(messages) {
        received = messages;
        return [1, 2, 3];
      },
    };
    expect(countLfmPromptTokens(
      model,
      [{ role: "user", content: "Hi" }],
      { tools: [lookupTool] },
    )).toBe(3);
    expect(received[0].role).toBe("system");
    expect(received[0].content).toContain("lookup");
  });
});
