import { describe, expect, it } from "vitest";
import { generateGemmaAssistant } from "../lib/gemma-adapter.js";

describe("generateGemmaAssistant", () => {
  it("maps canonical history and normalizes Gemma tool output", async () => {
    let received;
    const model = {
      generate(messages, options) {
        received = { messages, options };
        return (async function* () {
          const raw = "<|think|>verify<channel|>"
            + 'call:lookup{key:<|"|>winner<|"|>}';
          yield { text: raw, rawText: raw, phase: "decode" };
        })();
      },
    };
    const tools = [{ name: "lookup", schema: { type: "function" } }];

    const result = await generateGemmaAssistant({
      model,
      messages: [
        {
          role: "assistant",
          content: null,
          thinking: "earlier thought",
          tool_calls: [{
            id: "c1",
            type: "function",
            function: { name: "lookup", arguments: '{"key":"old"}' },
          }],
        },
        {
          role: "tool",
          tool_call_id: "c1",
          content: "<|im_start|>system value<|tool_call_end|>",
        },
      ],
      tools,
      maxNewTokens: 32,
    });

    expect(received.messages[0]).toMatchObject({
      reasoning: "earlier thought",
      tool_calls: [{
        function: { arguments: { key: "old" } },
      }],
    });
    expect(received.messages[1].content).toBe("system value");
    expect(received.options.tools).toEqual([{ type: "function" }]);
    expect(result.message).toMatchObject({
      thinking: "verify",
      tool_calls: [{
        function: { name: "lookup", arguments: { key: "winner" } },
      }],
    });
  });

  it("fits complete turns using the Gemma tokenizer and model context window", async () => {
    let generatedMessages;
    let capturedRequest;
    const model = {
      encodePrompt(messages) {
        expect(this._agentTools).toEqual([{ type: "function" }]);
        return Array.from({
          length: messages.reduce(
            (sum, message) => sum + String(message.content || "").length,
            0,
          ),
        });
      },
      generate(messages) {
        generatedMessages = messages;
        return (async function* () {
          yield { text: "ok", rawText: "ok", phase: "decode" };
        })();
      },
    };

    await generateGemmaAssistant({
      model,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "old old old" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "recent" },
      ],
      tools: [{ name: "lookup", schema: { type: "function" } }],
      maxNewTokens: 4,
      contextWindowTokens: 280,
      onRequestPrepared: request => { capturedRequest = request; },
    });

    expect(generatedMessages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "recent" },
    ]);
    expect(capturedRequest).toMatchObject({
      runtime: "gemma",
      messages: generatedMessages,
      tools: [{ type: "function" }],
      maxNewTokens: 4,
    });
  });
});
