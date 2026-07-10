import { describe, expect, it } from "vitest";
import {
  buildEffectiveSystemPrompt,
  buildGrammarSuffix,
  buildMessages,
  exportSessionOpenAI,
  splitThinking,
} from "../lib/messages.js";

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
});

describe("buildEffectiveSystemPrompt", () => {
  it("combines base prompt and grammar suffix", () => {
    expect(buildEffectiveSystemPrompt("Base", { grammarMode: "off" })).toBe("Base");
    expect(buildEffectiveSystemPrompt("", { grammarMode: "json" })).toContain("JSON");
    expect(buildEffectiveSystemPrompt("", { grammarMode: "off" })).toBe("");
  });
});
