import { describe, expect, it } from "vitest";
import {
  parseLfmToolOutput,
  renderLfmToolCalls,
} from "../lib/lfm-tool-parser.js";

describe("LFM tool protocol", () => {
  it("parses native Python-style calls and keeps accompanying content", () => {
    const parsed = parseLfmToolOutput(
      '<|tool_call_start|>[web_search(queries=["latest news", \'weather\'])]'
      + "<|tool_call_end|>I will check.<|im_end|>",
    );

    expect(parsed).toEqual({
      content: "I will check.",
      toolCalls: [{
        name: "web_search",
        arguments: { queries: ["latest news", "weather"] },
      }],
      truncated: false,
    });
  });

  it("supports multiple calls and nested literal arguments", () => {
    const parsed = parseLfmToolOutput(
      '<|tool_call_start|>[lookup(key="a", options={"limit": 2}), '
      + "lookup(key='b', options={'fresh': True})]<|tool_call_end|>",
      ["lookup"],
    );

    expect(parsed.toolCalls).toEqual([
      { name: "lookup", arguments: { key: "a", options: { limit: 2 } } },
      { name: "lookup", arguments: { key: "b", options: { fresh: true } } },
    ]);
  });

  it("parses local read and grep named arguments", () => {
    const parsed = parseLfmToolOutput(
      '<|tool_call_start|>[read(path="notes (2).md", offset=81), '
      + "grep(pattern='deadline', include='*.md', ignore_case=True)]"
      + "<|tool_call_end|>",
      ["read", "grep"],
    );
    expect(parsed.toolCalls).toEqual([
      { name: "read", arguments: { path: "notes (2).md", offset: 81 } },
      {
        name: "grep",
        arguments: { pattern: "deadline", include: "*.md", ignore_case: true },
      },
    ]);
  });

  it("parses calls when a decoder strips LFM control tokens", () => {
    const parsed = parseLfmToolOutput(
      "[web_search(queries=['latest Apple news'])]",
    );
    expect(parsed).toEqual({
      content: "",
      toolCalls: [{
        name: "web_search",
        arguments: { queries: ["latest Apple news"] },
      }],
      truncated: false,
    });
  });

  it("rejects unknown and incomplete calls", () => {
    expect(parseLfmToolOutput(
      "<|tool_call_start|>[unknown()]<|tool_call_end|>",
      ["lookup"],
    )).toMatchObject({ toolCalls: [], truncated: true });
    expect(parseLfmToolOutput(
      "<|tool_call_start|>[lookup(key='x')",
      ["lookup"],
    )).toMatchObject({ toolCalls: [], truncated: true });
    expect(parseLfmToolOutput(
      "[lookup(key='x')",
      ["lookup"],
    )).toMatchObject({ toolCalls: [], truncated: true });
  });

  it("renders canonical calls for LFM conversation history", () => {
    expect(renderLfmToolCalls([{
      function: {
        name: "lookup",
        arguments: { keys: ["a", "b"], exact: true },
      },
    }])).toBe(
      '<|tool_call_start|>[lookup(keys=["a", "b"], exact=True)]'
      + "<|tool_call_end|>",
    );
  });
});
