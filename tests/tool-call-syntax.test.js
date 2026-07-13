import { describe, expect, it } from "vitest";
import {
  findCompleteToolCalls,
  hasCompleteToolCall,
  scanBalancedBraces,
} from "../lib/tool-call-syntax.js";

describe("scanBalancedBraces", () => {
  it("handles nested braces inside escape-quoted strings", () => {
    const text = '{query:<|"|>foo {bar}<|"|>} trailing';
    expect(scanBalancedBraces(text, 0)).toBe(text.indexOf("} trailing"));
  });

  it("returns -1 when braces are unbalanced", () => {
    expect(scanBalancedBraces("{query:partial", 0)).toBe(-1);
  });
});

describe("generic tool-call detection", () => {
  it("detects bare, wrapped, and malformed-wrapper calls", () => {
    expect(findCompleteToolCalls(
      "call:web_search{query:latest NBA trades}",
    )[0].arguments).toEqual({ query: "latest NBA trades" });
    expect(findCompleteToolCalls(
      '<|tool_call>call:web_search{queries:[<|"|>x<|"|>]}<turn|>',
    )[0].arguments).toEqual({ queries: ["x"] });
    expect(hasCompleteToolCall(
      '<|tool_call|>call:web_search{query:<|"|>weather<|"|>}<tool_call|>',
    )).toBe(true);
  });

  it("supports arbitrary declared tool names", () => {
    const calls = findCompleteToolCalls(
      'call:lookup{key:<|"|>x<|"|>}',
      ["lookup"],
    );
    expect(calls[0]).toMatchObject({
      name: "lookup",
      arguments: { key: "x" },
    });
  });

  it("handles braces inside quoted arguments", () => {
    expect(findCompleteToolCalls(
      'call:web_search{query:"foo {bar}"}',
    )[0].arguments.query).toBe("foo {bar}");
  });

  it("excludes calls in thought channels", () => {
    expect(findCompleteToolCalls(
      "<|think|>draft call:web_search{query:secret}",
    )).toEqual([]);
    expect(findCompleteToolCalls(
      "<|think|>draft<channel|>call:web_search{query:secret}",
    )).toHaveLength(1);
  });

  it("ignores incomplete calls", () => {
    expect(findCompleteToolCalls("call:web_search{query:partial")).toEqual([]);
  });
});
