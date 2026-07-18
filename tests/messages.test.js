import { describe, expect, it } from "vitest";
import {
  applyAgentPolicy,
  buildAgentMessages,
  buildEffectiveSystemPrompt,
  buildGrammarSuffix,
  buildMessages,
  buildRuntimeDateContext,
  exportSessionOpenAI,
  exportSessionTrace,
  splitModelThinking,
  splitThinking,
} from "../lib/messages.js";
import { DEFAULT_SYSTEM_PROMPT } from "../lib/constants.js";
import {
  EXTERNAL_TOOL_DATA_GUARD,
  WEB_SEARCH_RESULT_POLICY,
  WEB_SEARCH_TOOL_SPEC,
  WEB_SEARCH_USE_POLICY,
} from "../lib/tools.js";

const canonicalSession = {
  id: "s1",
  title: "Search",
  modelId: "gemma4",
  systemPrompt: "Be helpful",
  messages: [
    { role: "user", content: "Search scores" },
    {
      role: "assistant",
      content: null,
      thinking: "I should search.",
      tool_calls: [{
        id: "c1",
        type: "function",
        function: { name: "web_search", arguments: { queries: ["scores"] } },
      }],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      name: "web_search",
      content: "search results",
      meta: { resultCount: 1, status: "ok" },
    },
    { role: "assistant", content: "Brazil won.", meta: { tokens: 4 } },
  ],
};

describe("grammar prompts", () => {
  it("builds JSON and EBNF suffixes", () => {
    expect(buildGrammarSuffix({
      grammarMode: "json",
      jsonSchema: '{"type":"object"}',
    })).toContain("JSON Schema");
    expect(buildGrammarSuffix({
      grammarMode: "ebnf",
      ebnf: "root ::= value",
    })).toContain("root ::= value");
    expect(buildGrammarSuffix({ grammarMode: "off" })).toBe("");
  });

  it("combines the base prompt and suffix", () => {
    expect(buildEffectiveSystemPrompt("Base", {
      grammarMode: "json",
      jsonSchema: "{}",
    })).toContain("Base");
  });

  it("adds the knowledge cutoff and current date", () => {
    expect(buildRuntimeDateContext(new Date("2026-07-13T12:00:00Z")))
      .toBe(
        "Your knowledge cutoff is January 2025.\n"
        + "Today is: July 13, 2026.",
      );
  });
});

describe("message construction", () => {
  it("builds ordinary chat context without tool internals", () => {
    const messages = buildMessages(canonicalSession, { grammarMode: "off" });
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "Search scores" },
      { role: "assistant", content: "Brazil won." },
    ]);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0].content).toContain("Be helpful");
    expect(messages[0].content).toContain("Your knowledge cutoff is January 2025.");
    expect(messages[0].content).toMatch(/Today is: .+\./);
  });

  it("uses the default system prompt", () => {
    expect(buildMessages({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hi" }],
    }, { grammarMode: "off" })[0].content).toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it("builds agent context from the canonical transcript unchanged", () => {
    const messages = buildAgentMessages(canonicalSession, [WEB_SEARCH_TOOL_SPEC]);
    expect(messages[0].content).toContain(WEB_SEARCH_USE_POLICY);
    expect(messages[0].content).toContain(WEB_SEARCH_RESULT_POLICY);
    expect(messages[0].content).toContain(EXTERNAL_TOOL_DATA_GUARD);
    expect(messages.slice(1)).toEqual(canonicalSession.messages);
  });

  it("only includes policies for active tools", () => {
    const messages = buildAgentMessages(canonicalSession, [{
      name: "calculator",
      promptPolicy: ["Use exact arithmetic."],
      resultTrust: "trusted",
    }]);

    expect(messages[0].content).toContain("calculator");
    expect(messages[0].content).toContain("Use exact arithmetic.");
    expect(messages[0].content).not.toContain("web_search");
    expect(messages[0].content).not.toContain(EXTERNAL_TOOL_DATA_GUARD);
  });

  it("applies active tool policy without mutating the base transcript", () => {
    const base = buildAgentMessages(canonicalSession);
    const prepared = applyAgentPolicy(base, [WEB_SEARCH_TOOL_SPEC], {
      toolProtocol: "Use the runtime protocol.",
    });

    expect(base[0].content).not.toContain("web_search");
    expect(prepared[0].content).toContain("web_search");
    expect(prepared[0].content).toContain("Use the runtime protocol.");
    expect(applyAgentPolicy(base, [])).toBe(base);
  });

});

describe("exports", () => {
  it("exports canonical messages in OpenAI order and stringifies arguments", () => {
    const exported = exportSessionOpenAI(canonicalSession);
    expect(exported.map(message => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(exported[2].tool_calls[0].function.arguments)
      .toBe('{"queries":["scores"]}');
    expect(exported[3]).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: "search results",
    });
    expect(exported[4]).not.toHaveProperty("meta");
  });

  it("exports a versioned debug trace with local metadata", () => {
    const trace = exportSessionTrace({
      ...canonicalSession,
      lastExecution: {
        mode: "agent",
        tools: ["web_search"],
        generations: 2,
        toolCalls: 1,
      },
    }, { agentMode: true, tools: [WEB_SEARCH_TOOL_SPEC] });
    expect(trace.version).toBe(2);
    expect(trace.modelContext.messages[0].content).toContain("web_search");
    expect(trace.openaiMessages[2].tool_calls).toHaveLength(1);
    expect(trace.messages[2].meta.resultCount).toBe(1);
    expect(trace.execution).toMatchObject({ mode: "agent", generations: 2 });
  });

  it("does not invent tools when an agent trace omits registrations", () => {
    const trace = exportSessionTrace(canonicalSession, { agentMode: true });

    expect(trace.modelContext.tools).toEqual([]);
    expect(trace.promptLayers.agentPolicy).toEqual([]);
    expect(trace.modelContext.messages[0].content).not.toContain("web_search");
  });
});

describe("splitModelThinking", () => {
  it("routes Bonsai redacted_thinking tags to the thinking panel", () => {
    expect(splitModelThinking(
      "<think>verify</think>Hello",
      "bonsai",
    )).toEqual({ thinking: "verify", output: "Hello" });
  });

  it("routes Gemma channels through splitThinking", () => {
    expect(splitModelThinking(
      "<|channel>thought\nreason\n<channel|>\nanswer",
      "gemma",
    )).toEqual({ thinking: "reason", output: "answer" });
  });
});

describe("splitThinking", () => {
  it("separates Gemma thought and answer channels", () => {
    expect(splitThinking(
      "<|channel>thought\nreason\n<channel|>\nanswer",
    )).toEqual({ thinking: "reason", output: "answer" });
  });

  it("keeps an open thought channel out of visible output", () => {
    expect(splitThinking("<|think|>draft")).toEqual({
      thinking: "draft",
      output: "",
    });
  });
});
