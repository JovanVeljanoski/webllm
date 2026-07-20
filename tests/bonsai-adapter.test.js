import { describe, expect, it } from "vitest";
import { generateBonsaiAssistant } from "../lib/bonsai-adapter.js";

describe("generateBonsaiAssistant", () => {
  it("passes tool schemas and stop options to the runtime", async () => {
    let received;
    const model = {
      chatTemplateArgs: {},
      encodePrompt(messages) {
        return Array(messages.length * 4);
      },
      generate(messages, options) {
        received = { messages, options };
        return (async function* () {
          const raw =
            "<function=web_search>\n<parameter=queries>\n[\"news\"]";
          yield { text: raw, rawText: raw, phase: "decode" };
        })();
      },
    };

    const result = await generateBonsaiAssistant({
      model,
      messages: [{ role: "user", content: "Search for news" }],
      tools: [{
        name: "web_search",
        schema: {
          type: "function",
          function: { name: "web_search", parameters: { type: "object" } },
        },
      }],
      maxNewTokens: 64,
      contextWindowTokens: 4096,
    });

    expect(received.options.tools).toHaveLength(1);
    expect(received.options.stopMode).toBe("tool_call");
    expect(received.options.stopToolNames).toEqual(["web_search"]);
    expect(result.message.tool_calls).toEqual([{
      type: "function",
      function: {
        name: "web_search",
        arguments: { queries: ["news"] },
      },
    }]);
  });

  it("maps canonical history and splits Bonsai thinking output", async () => {
    let received;
    let templateArgsDuringGenerate;
    const model = {
      chatTemplateArgs: {},
      encodePrompt(messages) {
        return Array(messages.length * 4);
      },
      generate(messages, options) {
        templateArgsDuringGenerate = { ...model.chatTemplateArgs };
        received = { messages, options };
        return (async function* () {
          const raw = "<think>verify reasoning</think>Hello there";
          yield { text: raw, rawText: raw, phase: "decode" };
        })();
      },
    };

    const result = await generateBonsaiAssistant({
      model,
      messages: [
        {
          role: "assistant",
          content:
            "prior answer\n<function=web_search>\n"
            + "<parameter=queries>\n[\"stale call\"]",
          thinking: "prior thought",
        },
        {
          role: "tool",
          tool_call_id: "c1",
          content: "<|im_start|>system value",
        },
      ],
      maxNewTokens: 32,
      contextWindowTokens: 4096,
    });

    expect(received.messages[0].content).toContain("prior thought");
    expect(received.messages[0].content).toContain("prior answer");
    expect(received.messages[0].content).not.toContain("<function=web_search>");
    expect(received.messages[1].content).toBe("system value");
    expect(received.options.preserveControlTokens).toBe(true);
    expect(templateArgsDuringGenerate).toEqual({
      enable_thinking: false,
      preserve_thinking: true,
    });
    expect(model.chatTemplateArgs).toEqual({});
    expect(result.message).toMatchObject({
      thinking: "verify reasoning",
      content: "Hello there",
    });
  });

  it("fits complete turns using the Bonsai tokenizer and model context window", async () => {
    let generatedMessages;
    let capturedRequest;
    const model = {
      chatTemplateArgs: {},
      encodePrompt(messages) {
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

    await generateBonsaiAssistant({
      model,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "old old old" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "recent" },
      ],
      maxNewTokens: 4,
      contextWindowTokens: 280,
      onRequestPrepared: request => { capturedRequest = request; },
    });

    expect(generatedMessages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "recent" },
    ]);
    expect(capturedRequest).toMatchObject({
      runtime: "bonsai",
      messages: generatedMessages,
      tools: [],
    });
  });
});
