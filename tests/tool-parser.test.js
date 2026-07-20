import { describe, expect, it } from "vitest";
import {
  extractGemmaToolCalls,
  hasUnclosedThoughtChannel,
  looksLikeToolCallSyntax,
  parseGemmaToolOutput,
  parseToolCallArguments,
  splitThinking,
  stripToolCallSyntax,
} from "../lib/tool-parser.js";

describe("Gemma protocol parsing", () => {
  it("parses wrapped and bare calls", () => {
    expect(parseGemmaToolOutput(
      '<|tool_call>call:web_search{queries:[<|"|>scores<|"|>]}<tool_call|>',
    ).toolCalls[0]).toEqual({
      name: "web_search",
      arguments: { queries: ["scores"] },
    });
    expect(parseGemmaToolOutput(
      "call:web_search{query:latest news}",
    ).toolCalls[0].arguments).toEqual({ query: "latest news" });
  });

  it("parses arbitrary allowed tool names", () => {
    expect(parseGemmaToolOutput(
      "call:lookup{key:x}",
      ["lookup"],
    ).toolCalls[0]).toEqual({
      name: "lookup",
      arguments: { key: "x" },
    });
  });

  it("parses read and grep calls with file paths and search controls", () => {
    expect(parseGemmaToolOutput(
      'call:read{path:<|"|>notes (2).md<|"|>,offset:81,limit:100}',
      ["read", "grep"],
    ).toolCalls[0]).toEqual({
      name: "read",
      arguments: { path: "notes (2).md", offset: 81, limit: 100 },
    });
    expect(parseGemmaToolOutput(
      'call:grep{pattern:<|"|>deadline<|"|>,include:<|"|>*.md<|"|>,ignore_case:true}',
      ["read", "grep"],
    ).toolCalls[0]).toEqual({
      name: "grep",
      arguments: { pattern: "deadline", include: "*.md", ignore_case: true },
    });
  });

  it("marks incomplete syntax as truncated", () => {
    const parsed = parseGemmaToolOutput(
      '<|tool_call>call:web_search{query:<|"|>partial',
    );
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.truncated).toBe(true);
  });

  it("recognizes partial tool syntax before it can flash as answer text", () => {
    expect(looksLikeToolCallSyntax("<|tool_call>call:web_se")).toBe(true);
    expect(looksLikeToolCallSyntax("<|tool_call_start|>[web_se")).toBe(true);
    expect(looksLikeToolCallSyntax("[web_search(queries=['news'])]")).toBe(true);
    expect(looksLikeToolCallSyntax("call:web_search")).toBe(true);
    expect(looksLikeToolCallSyntax("ordinary answer")).toBe(false);
  });

  it("strips LFM tool calls from visible answer text", () => {
    expect(stripToolCallSyntax(
      '<|tool_call_start|>[web_search(queries=["news"])]'
      + "<|tool_call_end|>Checking.",
    )).toBe("Checking.");
    expect(stripToolCallSyntax(
      "[web_search(queries=['news'])] Checking.",
    )).toBe("Checking.");
  });

  it("does not parse calls from an open thought channel", () => {
    const parsed = parseGemmaToolOutput(
      "<|think|>draft call:web_search{query:secret}",
    );
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.thinking).toContain("web_search");
  });

  it("splits thinking from visible content and tool syntax", () => {
    const raw = "<|think|>verify<channel|>call:web_search{query:scores}";
    const parsed = parseGemmaToolOutput(raw);
    expect(parsed.thinking).toBe("verify");
    expect(stripToolCallSyntax(parsed.content)).toBe("");
  });
});

describe("Gemma argument parsing", () => {
  it("parses escaped, quoted, and array values", () => {
    expect(parseToolCallArguments(
      'queries:[<|"|>one<|"|>,<|"|>two<|"|>],label:"x"',
    )).toEqual({ queries: ["one", "two"], label: "x" });
  });

  it("requires a wrapper in strict extraction mode", () => {
    expect(extractGemmaToolCalls(
      "call:web_search{query:x}",
      true,
    )).toEqual([]);
  });
});

describe("thought channels", () => {
  it("detects open and closed channels", () => {
    expect(hasUnclosedThoughtChannel("<|think|>draft")).toBe(true);
    expect(hasUnclosedThoughtChannel("<|think|>draft<channel|>")).toBe(false);
  });

  it("keeps open thinking out of output", () => {
    expect(splitThinking("<|think|>draft")).toEqual({
      thinking: "draft",
      output: "",
    });
  });
});
