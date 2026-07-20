import { describe, expect, it, vi } from "vitest";
import {
  MAX_MODEL_GENERATIONS,
  MAX_TOOL_CALLS_PER_GENERATION,
  MAX_TOOL_ROUNDS,
  runAgentTurn,
} from "../lib/agent-loop.js";

function mockGenerate(outputs) {
  let index = 0;
  const calls = [];
  const generateFn = vi.fn(async params => {
    calls.push({
      messages: structuredClone(params.messages),
      tools: params.tools.map(tool => tool.name),
    });
    params.onRequestPrepared?.({
      runtime: "test",
      messages: structuredClone(params.messages),
      tools: params.tools.map(tool => tool.schema),
    });
    const message = outputs[Math.min(index++, outputs.length - 1)];
    return {
      message: structuredClone(message),
      raw: message.content || "",
      metrics: { tokens: 1 },
      truncated: false,
    };
  });
  return { calls, generateFn };
}

function toolCall(name, args = {}) {
  return {
    role: "assistant",
    content: null,
    thinking: "Need a tool.",
    tool_calls: [{
      type: "function",
      function: { name, arguments: args },
    }],
  };
}

describe("runAgentTurn", () => {
  it("passes complete history and appends an ordinary answer", async () => {
    const messages = [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Current" },
    ];
    const mock = mockGenerate([{ role: "assistant", content: "Answer" }]);

    const result = await runAgentTurn({
      messages,
      tools: [],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
    });

    expect(mock.calls[0].messages).toEqual(messages);
    expect(result.content).toBe("Answer");
    expect(result.newMessages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Answer" }),
    ]);
  });

  it("labels exact prepared requests with their generation number", async () => {
    const captured = [];
    const mock = mockGenerate([{ role: "assistant", content: "Answer" }]);

    await runAgentTurn({
      messages: [{ role: "user", content: "Current" }],
      tools: [],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
      onRequestPrepared: request => captured.push(request),
    });

    expect(captured).toEqual([expect.objectContaining({
      generation: 1,
      runtime: "test",
    })]);
  });

  it("executes an arbitrary registered tool and continues", async () => {
    const mock = mockGenerate([
      toolCall("lookup", { key: "x" }),
      { role: "assistant", content: "Found it." },
    ]);
    const execute = vi.fn(async args => ({
      content: `value:${args.key}`,
      meta: { status: "ok" },
    }));
    const events = [];

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Look it up" }],
      tools: [{ name: "lookup", schema: {}, execute, parallelSafe: true }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
      callIdPrefix: "test",
      onEvent: event => events.push(event.type),
    });

    expect(execute).toHaveBeenCalledWith({ key: "x" }, expect.any(Object));
    expect(mock.calls[1].messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(result.newMessages.map(message => message.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.newMessages[1].content).toBe("value:x");
    expect(events).toEqual([
      "generation_start",
      "message_end",
      "tool_start",
      "tool_end",
      "generation_start",
      "message_end",
    ]);
  });

  it("executes multiple tool calls in parallel and preserves call order", async () => {
    const first = toolCall("lookup", { key: "a" });
    first.tool_calls.push({
      type: "function",
      function: { name: "lookup", arguments: { key: "b" } },
    });
    const mock = mockGenerate([
      first,
      { role: "assistant", content: "Done" },
    ]);
    const execute = vi.fn(async args => ({ content: args.key }));

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Both" }],
      tools: [{ name: "lookup", schema: {}, execute, parallelSafe: true }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.newMessages.filter(message => message.role === "tool")
      .map(message => message.content)).toEqual(["a", "b"]);
  });

  it("runs tools sequentially unless every call opts into parallel execution", async () => {
    const first = toolCall("write", { key: "a" });
    first.tool_calls.push({
      type: "function",
      function: { name: "write", arguments: { key: "b" } },
    });
    const mock = mockGenerate([
      first,
      { role: "assistant", content: "Done" },
    ]);
    let active = 0;
    let maxActive = 0;
    const execute = async args => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return { content: args.key };
    };

    await runAgentTurn({
      messages: [{ role: "user", content: "Write both" }],
      tools: [{ name: "write", schema: {}, execute }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
    });

    expect(maxActive).toBe(1);
  });

  it("caps tool-call fan-out within one generation", async () => {
    const first = toolCall("lookup", { key: "0" });
    for (let index = 1; index < MAX_TOOL_CALLS_PER_GENERATION + 2; index++) {
      first.tool_calls.push({
        type: "function",
        function: { name: "lookup", arguments: { key: String(index) } },
      });
    }
    const mock = mockGenerate([
      first,
      { role: "assistant", content: "Done" },
    ]);
    const execute = vi.fn(async args => ({ content: args.key }));

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Many" }],
      tools: [{ name: "lookup", schema: {}, execute }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
    });

    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_GENERATION);
    expect(result.newMessages[0].tool_calls)
      .toHaveLength(MAX_TOOL_CALLS_PER_GENERATION);
  });

  it("returns tool failures to the model", async () => {
    const mock = mockGenerate([
      toolCall("broken"),
      { role: "assistant", content: "Recovered" },
    ]);

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Try" }],
      tools: [{
        name: "broken",
        schema: {},
        execute: async () => { throw new Error("boom"); },
      }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
    });

    const toolResult = result.newMessages.find(message => message.role === "tool");
    expect(toolResult.content).toContain("boom");
    expect(toolResult.meta.status).toBe("error");
    expect(result.content).toBe("Recovered");
  });

  it("disables tools for the final generation after the round limit", async () => {
    const outputs = Array.from({ length: MAX_TOOL_ROUNDS }, (_, index) =>
      toolCall("lookup", { index }));
    outputs.push({ role: "assistant", content: "Final" });
    const mock = mockGenerate(outputs);

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Loop" }],
      tools: [{ name: "lookup", schema: {}, execute: async () => ({ content: "ok" }) }],
      generateFn: mock.generateFn,
      prepareMessages: (messages, activeTools) => [
        {
          role: "system",
          content: activeTools.length ? "Tools are active." : "Tools are disabled.",
        },
        ...messages,
      ],
      model: {},
      maxNewTokens: 64,
    });

    expect(mock.calls).toHaveLength(MAX_MODEL_GENERATIONS);
    expect(mock.calls[0].messages[0].content).toBe("Tools are active.");
    expect(mock.calls.at(-1).messages[0].content).toBe("Tools are disabled.");
    expect(mock.calls.at(-1).tools).toEqual([]);
    expect(result.content).toBe("Final");
  });

  it("returns a visible fallback if the final generation requests another tool", async () => {
    const outputs = Array.from(
      { length: MAX_TOOL_ROUNDS + 1 },
      (_, index) => toolCall("lookup", { index }),
    );
    const mock = mockGenerate(outputs);

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Loop" }],
      tools: [{ name: "lookup", schema: {}, execute: async () => ({ content: "ok" }) }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
    });

    expect(result.content).toMatch(/tool-use limit/i);
    expect(result.newMessages.at(-1).tool_calls).toBeUndefined();
  });

  it("keeps tool-call transcripts valid when execution is aborted", async () => {
    const controller = new AbortController();
    const mock = mockGenerate([toolCall("lookup")]);

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Stop" }],
      tools: [{
        name: "lookup",
        schema: {},
        execute: async () => {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        },
      }],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.newMessages.map(message => message.role)).toEqual([
      "assistant",
      "tool",
    ]);
    expect(result.newMessages[1].meta.status).toBe("aborted");
  });

  it("returns a visible fallback for an incomplete tool request", async () => {
    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Search" }],
      tools: [{ name: "lookup", schema: {}, execute: vi.fn() }],
      generateFn: async () => ({
        message: { role: "assistant", content: null, tool_calls: [] },
        raw: "call:lookup{",
        metrics: null,
        truncated: true,
      }),
      model: {},
      maxNewTokens: 64,
    });

    expect(result.content).toMatch(/valid tool request/i);
  });

  it("returns partial state when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = mockGenerate([{ role: "assistant", content: "partial" }]);

    const result = await runAgentTurn({
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      generateFn: mock.generateFn,
      model: {},
      maxNewTokens: 64,
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.truncated).toBe(true);
    expect(mock.generateFn).not.toHaveBeenCalled();
  });
});
