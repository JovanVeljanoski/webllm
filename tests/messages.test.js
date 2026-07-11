import { describe, expect, it } from "vitest";
import {
  buildAgentMessages,
  buildEffectiveSystemPrompt,
  buildGrammarSuffix,
  buildMessages,
  exportSessionOpenAI,
  splitThinking,
} from "../lib/messages.js";
import { TOOL_SYSTEM_GUARD, TOOL_USE_INSTRUCTION } from "../lib/tools.js";

describe("grammar suffix", () => {
  it("returns empty when grammar is off", () => {
    expect(buildGrammarSuffix({ grammarMode: "off" })).toBe("");
  });

  it("embeds JSON schema instructions", () => {
    const suffix = buildGrammarSuffix({
      grammarMode: "json",
      jsonSchema: '{"type":"object"}',
    });
    expect(suffix).toContain("JSON Schema");
    expect(suffix).toContain('{"type":"object"}');
  });

  it("embeds EBNF when provided", () => {
    const suffix = buildGrammarSuffix({
      grammarMode: "ebnf",
      ebnf: "root ::= value",
    });
    expect(suffix).toContain("```ebnf");
    expect(suffix).toContain("root ::= value");
  });

  it("skips EBNF block when empty", () => {
    expect(buildGrammarSuffix({ grammarMode: "ebnf", ebnf: "  " })).toBe("");
  });
});

describe("buildMessages", () => {
  const session = {
    systemPrompt: "Be helpful",
    messages: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "system", content: "ignored" },
    ],
  };

  it("includes grammar-augmented system prompt and chat turns", () => {
    const msgs = buildMessages(session, { grammarMode: "json", jsonSchema: "{}" });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Be helpful");
    expect(msgs[0].content).toContain("JSON");
    expect(msgs).toEqual([
      msgs[0],
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("exportSessionOpenAI excludes grammar injection", () => {
    const exported = exportSessionOpenAI(session);
    expect(exported).toEqual([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("builds agent messages with tool guard and no grammar", () => {
    const agentSession = {
      systemPrompt: "Be helpful",
      messages: [
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: "Searching…",
          reasoning: "plan",
          tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: { query: "x" } } }],
        },
      ],
    };
    const msgs = buildMessages(agentSession, { grammarMode: "json", jsonSchema: "{}" }, { agentMode: true });
    expect(msgs[0].content).toContain("Be helpful");
    expect(msgs[0].content).toContain(TOOL_SYSTEM_GUARD);
    expect(msgs[0].content).toContain(TOOL_USE_INSTRUCTION);
    expect(msgs[0].content).not.toContain("JSON");
    expect(msgs[2]).toMatchObject({
      role: "assistant",
      content: "Searching…",
    });
    expect(msgs[2].tool_calls).toBeUndefined();
  });
});

describe("splitThinking", () => {
  it("splits gemma-style thought channel from output", () => {
    const raw = "<|channel>thought\nhmm\n<channel|>\nAnswer";
    expect(splitThinking(raw)).toEqual({ thinking: "hmm", output: "Answer" });
  });

  it("appends any pre-thought text after the visible answer", () => {
    const raw = "prefix<|channel>thought\nhmm\n<channel|>\nAnswer";
    expect(splitThinking(raw)).toEqual({ thinking: "hmm", output: "Answerprefix" });
  });

  it("handles streaming-only thinking without close tag", () => {
    expect(splitThinking("<|think|>\nstill thinking")).toEqual({
      thinking: "still thinking",
      output: "",
    });
  });

  it("returns plain text unchanged", () => {
    expect(splitThinking("Just answer")).toEqual({ thinking: "", output: "Just answer" });
  });

  it("strips leaked channel control tokens from answer output", () => {
    const raw = "<|channel>thought\nplan\n<channel|>\n<|channel|>\nHello";
    expect(splitThinking(raw)).toEqual({ thinking: "plan", output: "Hello" });
  });

  it("sanitizes tool-call syntax from visible answer output", () => {
    const toolCall =
      '<|tool_call>call:web_search{query:<|"|>weather<|"|>}<tool_call|>';
    expect(splitThinking(toolCall).output).toBe("call:web_search{query:weather}");
  });
});

describe("buildAgentMessages", () => {
  it("appends ephemeral tool messages", () => {
    const session = { systemPrompt: "", messages: [{ role: "user", content: "q" }] };
    const msgs = buildAgentMessages(session, {
      ephemeral: [{ role: "tool", tool_call_id: "c1", content: "results" }],
    });
    expect(msgs.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: "results" });
  });

  it("keeps only final assistant prose from prior agent turns", () => {
    const session = {
      systemPrompt: "",
      messages: [
        { role: "user", content: "search scores" },
        {
          role: "assistant",
          content: "Brazil 2 - 1 France",
          agentTranscript: [
            {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "c1",
                type: "function",
                function: { name: "web_search", arguments: { query: "scores" } },
              }],
            },
            { role: "tool", tool_call_id: "c1", content: "search results here" },
          ],
        },
        { role: "user", content: "and?" },
      ],
    };
    const msgs = buildAgentMessages(session);
    expect(msgs.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(msgs[2].content).toBe("Brazil 2 - 1 France");
  });
});

describe("buildEffectiveSystemPrompt", () => {
  it("combines base prompt and grammar suffix", () => {
    expect(buildEffectiveSystemPrompt("Base", { grammarMode: "off" })).toBe("Base");
    expect(buildEffectiveSystemPrompt("", { grammarMode: "json" })).toContain("JSON");
    expect(buildEffectiveSystemPrompt("", { grammarMode: "off" })).toBe("");
  });
});
