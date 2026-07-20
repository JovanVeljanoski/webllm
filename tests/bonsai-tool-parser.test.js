import { describe, expect, it } from "vitest";
import {
  extractBonsaiToolCalls,
  looksLikeBonsaiToolCallSyntax,
  parseBonsaiToolOutput,
  parseXmlParameters,
  renderBonsaiToolCalls,
  splitBonsaiThinking,
  stripBonsaiToolCallSyntax,
} from "../lib/bonsai-tool-parser.js";

describe("splitBonsaiThinking", () => {
  it("splits closed thinking blocks from visible content", () => {
    expect(splitBonsaiThinking(
      "<think>plan</think>Answer",
    )).toEqual({
      thinking: "plan",
      output: "Answer",
    });
  });

  it("keeps open thinking channels in thinking only", () => {
    expect(splitBonsaiThinking(
      "<think>still thinking",
    )).toEqual({
      thinking: "still thinking",
      output: "",
    });
  });
});

describe("parseXmlParameters", () => {
  it("parses Qwen parameter blocks", () => {
    expect(parseXmlParameters(
      "<parameter=queries>\n[\"one\", \"two\"]\n</parameter>",
    )).toEqual({
      queries: "[\"one\", \"two\"]",
    });
  });

  it("recovers a complete JSON value when closing tags are omitted", () => {
    expect(parseXmlParameters(
      "<parameter=queries>\n[\"Wimbledon 2026 winners\"]",
    )).toEqual({
      queries: "[\"Wimbledon 2026 winners\"]",
    });
  });
});

describe("Bonsai tool parsing", () => {
  const xmlCall =
    "<tool_call>\n<function=web_search>\n<parameter=queries>\n" +
    "[\"latest scores\", \"team standings\"]\n</parameter>\n</tool_call>";

  it("extracts web_search calls with normalized queries", () => {
    expect(extractBonsaiToolCalls(xmlCall)).toEqual([{
      name: "web_search",
      arguments: { queries: ["latest scores", "team standings"] },
    }]);
  });

  it("parses local read and grep calls with Unicode paths", () => {
    const readCall =
      "<tool_call>\n<function=read>\n"
      + "<parameter=path>\nRésumé notes.md\n</parameter>\n"
      + "<parameter=offset>\n12\n</parameter>\n</tool_call>";
    expect(extractBonsaiToolCalls(readCall, false, ["read", "grep"])).toEqual([{
      name: "read",
      arguments: { path: "Résumé notes.md", offset: 12 },
    }]);

    const grepCall =
      "<tool_call>\n<function=grep>\n"
      + "<parameter=pattern>\ndeadline\n</parameter>\n"
      + "<parameter=ignore_case>\ntrue\n</parameter>\n</tool_call>";
    expect(extractBonsaiToolCalls(grepCall, false, ["read", "grep"])).toEqual([{
      name: "grep",
      arguments: { pattern: "deadline", ignore_case: true },
    }]);
  });

  it("parses thinking plus tool calls from raw output", () => {
    const parsed = parseBonsaiToolOutput(
      `<think>plan</think>${xmlCall}`,
    );
    expect(parsed.thinking).toBe("plan");
    expect(parsed.content).toBe("");
    expect(parsed.toolCalls).toEqual([{
      name: "web_search",
      arguments: { queries: ["latest scores", "team standings"] },
    }]);
    expect(parsed.truncated).toBe(false);
  });

  it("marks incomplete tool calls as truncated", () => {
    const parsed = parseBonsaiToolOutput(
      "<tool_call>\n<function=web_search>\n<parameter=queries>\n[\"partial\"",
    );
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.truncated).toBe(true);
  });

  it("recovers the wrapperless tool call observed in Bonsai browser output", () => {
    const raw =
      "<function=web_search>\n<parameter=queries>\n" +
      "[\"Wimbledon 2026 winners\"]";
    expect(parseBonsaiToolOutput(raw)).toEqual({
      thinking: "",
      content: "",
      toolCalls: [{
        name: "web_search",
        arguments: { queries: ["Wimbledon 2026 winners"] },
      }],
      truncated: false,
    });
    expect(stripBonsaiToolCallSyntax(raw)).toBe("");
  });

  it("ignores unknown tools", () => {
    expect(extractBonsaiToolCalls(
      "<tool_call>\n<function=lookup>\n<parameter=id>\n1\n</parameter>\n</tool_call>",
      false,
      ["web_search"],
    )).toEqual([]);
  });

  it("tolerates stray closing tags after a valid block", () => {
    const parsed = parseBonsaiToolOutput(
      `${xmlCall}</function></function_invocation>`,
    );
    expect(parsed.toolCalls).toHaveLength(1);
  });

  it("strips complete and incomplete tool-call blocks from visible text", () => {
    expect(stripBonsaiToolCallSyntax(`${xmlCall}\nHere is context.`)).toBe("Here is context.");
    expect(stripBonsaiToolCallSyntax(
      "<tool_call>\n<function=web_search>\npartial",
    )).toBe("");
  });

  it("renders canonical calls for conversation history", () => {
    expect(renderBonsaiToolCalls([{
      function: {
        name: "web_search",
        arguments: { queries: ["news", "weather"] },
      },
    }])).toBe(
      "<tool_call>\n<function=web_search>\n" +
      "<parameter=queries>\n[\"news\",\"weather\"]\n</parameter>\n</tool_call>",
    );
  });

  it("detects Qwen XML tool-call markers", () => {
    expect(looksLikeBonsaiToolCallSyntax("<tool_call><function=web_search>")).toBe(true);
    expect(looksLikeBonsaiToolCallSyntax("<")).toBe(true);
    expect(looksLikeBonsaiToolCallSyntax("<funct")).toBe(true);
    expect(looksLikeBonsaiToolCallSyntax("<tool_")).toBe(true);
    expect(looksLikeBonsaiToolCallSyntax("<p>answer</p>")).toBe(false);
    expect(looksLikeBonsaiToolCallSyntax("plain answer")).toBe(false);
  });
});
