import { describe, expect, it } from "vitest";
import {
  extractGemmaToolCalls,
  firstValidWebSearchCall,
  hasUnclosedThoughtChannel,
  isToolCallOnlyText,
  parseGemmaToolOutput,
  parseToolCallArguments,
  stripToolCallSyntax,
} from "../lib/tool-parser.js";

const TOOL_CALL =
  '<|tool_call>call:web_search{queries:[<|"|>weather in Berlin<|"|>]}<tool_call|>';
const LEGACY_TOOL_CALL =
  '<|tool_call>call:web_search{query:<|"|>weather in Berlin<|"|>}<tool_call|>';

describe("parseGemmaToolOutput", () => {
  it("parses complete web_search with call: prefix", () => {
    const parsed = parseGemmaToolOutput(TOOL_CALL);
    expect(parsed.toolCalls).toEqual([
      { name: "web_search", arguments: { queries: ["weather in Berlin"] } },
    ]);
    expect(parsed.truncated).toBe(false);
  });

  it("parses legacy single query argument", () => {
    const parsed = parseGemmaToolOutput(LEGACY_TOOL_CALL);
    expect(parsed.toolCalls[0].arguments.queries).toEqual(["weather in Berlin"]);
  });

  it("parses multiple queries in one call", () => {
    const raw =
      '<|tool_call>call:web_search{queries:[<|"|>Apple news<|"|>,<|"|>Utrecht weather<|"|>]}<tool_call|>';
    const parsed = parseGemmaToolOutput(raw);
    expect(parsed.toolCalls[0].arguments.queries).toEqual(["Apple news", "Utrecht weather"]);
  });

  it("parses web_search without call: prefix", () => {
    const raw =
      '<|tool_call>web_search{queries:[<|"|>WebGPU news July 2026<|"|>]}<tool_call|>';
    const parsed = parseGemmaToolOutput(raw);
    expect(parsed.toolCalls[0].arguments.queries).toEqual(["WebGPU news July 2026"]);
  });

  it("parses tool call ending with <turn|>", () => {
    const raw =
      '<|tool_call>call:web_search{queries:[<|"|>Berlin weather<|"|>]}<turn|>';
    expect(parseGemmaToolOutput(raw).toolCalls).toHaveLength(1);
  });

  it("parses fallback bare call:name{args} format", () => {
    const raw = 'Some text call:web_search{query:<|"|>latest news<|"|>} more';
    expect(parseGemmaToolOutput(raw).toolCalls[0].arguments.queries).toEqual(["latest news"]);
  });

  it("parses malformed <|tool_call|> opener without closing tag", () => {
    const raw =
      '<|tool_call|>call:web_search{queries:[<|"|>weather forecast for Utrecht next couple of days<|"|>]}';
    const parsed = parseGemmaToolOutput(raw);
    expect(parsed.toolCalls).toEqual([
      {
        name: "web_search",
        arguments: { queries: ["weather forecast for Utrecht next couple of days"] },
      },
    ]);
    expect(parsed.truncated).toBe(false);
    expect(isToolCallOnlyText(raw)).toBe(true);
    expect(stripToolCallSyntax(raw)).toBe("");
  });

  it("detects tool-call-only output", () => {
    expect(isToolCallOnlyText("call:web_search{queries:[<|\"|>scores<|\"|>]}")).toBe(true);
    expect(isToolCallOnlyText("call:web_search{query:scores}")).toBe(true);
    expect(isToolCallOnlyText("Here are the scores")).toBe(false);
  });

  it("marks truncated when tool_call opener has no closer", () => {
    const parsed = parseGemmaToolOutput('<|tool_call>call:web_search{queries:[<|"|>partial');
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.truncated).toBe(true);
  });

  it("parses tool calls even inside an open thought channel", () => {
    const raw = `<|channel>thought
still thinking
${TOOL_CALL}`;
    const parsed = parseGemmaToolOutput(raw);
    expect(parsed.toolCalls).toHaveLength(1);
  });

  it("splits thinking from tool call output", () => {
    const raw = `<|channel>thought
plan search
<channel|>
${TOOL_CALL}`;
    const parsed = parseGemmaToolOutput(raw);
    expect(parsed.thinking).toContain("plan search");
    expect(parsed.toolCalls).toHaveLength(1);
  });
});

describe("parseToolCallArguments", () => {
  it("parses escape-token quoted values", () => {
    expect(parseToolCallArguments('query:<|"|>hello world<|"|>')).toEqual({
      query: "hello world",
    });
  });

  it("parses queries array", () => {
    expect(parseToolCallArguments('queries:[<|"|>Apple news<|"|>,<|"|>Utrecht weather<|"|>]')).toEqual({
      queries: ["Apple news", "Utrecht weather"],
    });
  });

  it("parses plain quoted values", () => {
    expect(parseToolCallArguments('query: "Berlin weather"')).toEqual({
      query: "Berlin weather",
    });
  });
});

describe("extractGemmaToolCalls", () => {
  it("returns empty in strict mode without wrapper", () => {
    expect(extractGemmaToolCalls("call:web_search{query:x}", true)).toEqual([]);
  });
});

describe("firstValidWebSearchCall", () => {
  it("returns first web_search with non-empty queries", () => {
    const tc = firstValidWebSearchCall([
      { name: "other", arguments: { query: "x" } },
      { name: "web_search", arguments: { queries: ["  ok  "] } },
    ]);
    expect(tc?.arguments.queries).toEqual(["ok"]);
  });

  it("returns null when no valid call", () => {
    expect(firstValidWebSearchCall([])).toBeNull();
    expect(firstValidWebSearchCall([{ name: "web_search", arguments: { queries: ["  "] } }])).toBeNull();
    expect(firstValidWebSearchCall([{ name: "web_search", arguments: { query: "  " } }])).toBeNull();
  });
});

describe("hasUnclosedThoughtChannel", () => {
  it("detects open thought without close tag", () => {
    expect(hasUnclosedThoughtChannel("<|think|>\nworking")).toBe(true);
    expect(hasUnclosedThoughtChannel("<|channel>thought\nx\n<channel|>\nok")).toBe(false);
  });
});
