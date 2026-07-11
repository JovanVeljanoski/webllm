import { describe, expect, it } from "vitest";
import {
  findCompleteWebSearchCall,
  hasCompleteWebSearchToolCall,
  scanBalancedBraces,
} from "../lib/tool-call-detector.js";

describe("scanBalancedBraces", () => {
  it("handles nested braces inside escape-quoted strings", () => {
    const s = '{query:<|"|>foo {bar} baz<|"|>}';
    expect(scanBalancedBraces(s, 0)).toBe(s.length - 1);
  });

  it("returns -1 when braces are unbalanced", () => {
    expect(scanBalancedBraces("{query:partial", 0)).toBe(-1);
  });
});

describe("findCompleteWebSearchCall", () => {
  it("detects bare call at end", () => {
    const s = "call:web_search{query:latest NBA trades}";
    const hit = findCompleteWebSearchCall(s);
    expect(hit?.arguments.queries).toEqual(["latest NBA trades"]);
  });

  it("detects wrapped call with turn terminator", () => {
    const s = '<|tool_call>call:web_search{queries:[<|"|>x<|"|>]}<turn|>';
    expect(findCompleteWebSearchCall(s)?.arguments.queries).toEqual(["x"]);
  });

  it("detects malformed <|tool_call|> opener", () => {
    const s =
      '<|tool_call|>call:web_search{query:<|"|>weather forecast for Utrecht<|"|>}';
    expect(findCompleteWebSearchCall(s)?.arguments.queries).toEqual(["weather forecast for Utrecht"]);
    expect(hasCompleteWebSearchToolCall(s)).toBe(true);
  });

  it("detects query with braces inside escaped string", () => {
    const s = 'call:web_search{query:<|"|>foo {bar}<|"|>}';
    expect(findCompleteWebSearchCall(s)?.arguments.queries).toEqual(["foo {bar}"]);
  });

  it("ignores incomplete call", () => {
    expect(findCompleteWebSearchCall("call:web_search{query:partial")).toBeNull();
  });
});

describe("hasCompleteWebSearchToolCall", () => {
  it("returns true for complete bare calls", () => {
    expect(hasCompleteWebSearchToolCall("prefix call:web_search{query:ok}")).toBe(true);
  });
});
