import { describe, expect, it, vi } from "vitest";
import {
  MAX_SEARCH_CALLS,
  hasSubstantiveProse,
  runAgentTurn,
} from "../lib/agent-loop.js";

const TOOL_CALL =
  '<|tool_call>call:web_search{queries:[<|"|>test query<|"|>]}<tool_call|>';
const MULTI_TOOL_CALL =
  '<|tool_call>call:web_search{queries:[<|"|>Apple news July 2026<|"|>,<|"|>weather Utrecht today<|"|>]}<tool_call|>';
const FINAL_ANSWER = "Here is the answer based on search.";

function mockModel(outputs) {
  let call = 0;
  const reset = vi.fn();
  return {
    reset,
    generate(_messages, _opts) {
      const text = outputs[Math.min(call, outputs.length - 1)];
      call++;
      return (async function* () {
        yield { token: 1, delta: text, text, rawText: text };
      })();
    },
  };
}

describe("runAgentTurn", () => {
  it("returns final content when model does not call tools", async () => {
    const result = await runAgentTurn({
      model: mockModel(["Plain answer"]),
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      maxNewTokens: 64,
      searchFn: vi.fn(),
    });
    expect(result.content).toBe("Plain answer");
    expect(result.toolTrace).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("runs search then continues generation", async () => {
    const searchFn = vi.fn(async () => ({
      formatted: "[1] Doc\nURL: https://x.test\nsnippet",
      results: [{ id: "1", title: "Doc", url: "https://x.test", snippet: "snippet" }],
      rawProvider: "exa-mcp",
    }));

    const result = await runAgentTurn({
      model: mockModel([TOOL_CALL, FINAL_ANSWER]),
      messages: [{ role: "user", content: "Search something" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });

    expect(searchFn).toHaveBeenCalledOnce();
    expect(searchFn.mock.calls[0][0]).toBe("test query");
    expect(result.content).toBe(FINAL_ANSWER);
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]).toMatchObject({
      query: "test query",
      queries: ["test query"],
      provider: "exa-mcp",
      resultCount: 1,
      status: "ok",
    });
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
    expect(result.messages.some((m) => m.tool_calls)).toBe(true);
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("=== Search 1: test query ===");
    expect(toolMsg?.content).toContain("[1] Doc");
  });

  it("resets KV cache before continuation generation", async () => {
    const searchFn = vi.fn(async () => ({
      formatted: "results",
      results: [],
      rawProvider: "exa-mcp",
    }));
    const model = mockModel([TOOL_CALL, FINAL_ANSWER]);
    await runAgentTurn({
      model,
      messages: [{ role: "user", content: "Search something" }],
      tools: [],
      maxNewTokens: 64,
      searchFn,
    });
    expect(model.reset).toHaveBeenCalledTimes(2);
  });

  it("continues to synthesis after search instead of dumping raw results", async () => {
    const bare = "call:web_search{query:latest world cup scores}";
    const searchFn = vi.fn(async () => ({
      formatted: "[1] FIFA\nURL: https://fifa.test\nBrazil 2 - 1 France",
      results: [{ id: "1", title: "FIFA", url: "https://fifa.test", snippet: "scores" }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([bare, FINAL_ANSWER]),
      messages: [{ role: "user", content: "use web search for world cup scores" }],
      tools: [],
      maxNewTokens: 128,
      searchFn,
    });
    expect(result.content).toBe(FINAL_ANSWER);
    expect(result.content).not.toContain("[1] FIFA");
    expect(result.content).not.toContain("call:web_search");
  });

  it("retries synthesis when model returns empty after search", async () => {
    const searchFn = vi.fn(async () => ({
      formatted: "[1] Doc\nURL: https://x.test\nsnippet",
      results: [{ id: "1", title: "Doc", url: "https://x.test", snippet: "snippet" }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([TOOL_CALL, "", FINAL_ANSWER]),
      messages: [{ role: "user", content: "Search something" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });
    expect(result.content).toBe(FINAL_ANSWER);
    expect(searchFn).toHaveBeenCalledOnce();
  });

  it("falls back to raw search text only after synthesis budget is exhausted", async () => {
    const bare = "call:web_search{query:latest world cup scores}";
    const searchFn = vi.fn(async () => ({
      formatted: "[1] FIFA\nURL: https://fifa.test\nBrazil 2 - 1 France",
      results: [{ id: "1", title: "FIFA", url: "https://fifa.test", snippet: "scores" }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([bare, bare, bare, bare, bare]),
      messages: [{ role: "user", content: "use web search for world cup scores" }],
      tools: [],
      maxNewTokens: 128,
      searchFn,
    });
    expect(result.content).toContain("couldn't produce a sufficiently reliable summary");
    expect(result.content).not.toContain("Brazil 2 - 1 France");
    expect(result.truncated).toBe(true);
  });

  it("runs multiple queries from one web_search tool call", async () => {
    const searchFn = vi.fn(async (query) => ({
      formatted: `[1] ${query}\nURL: https://example.test\nsnippet for ${query}`,
      results: [{ id: "1", title: query, url: "https://example.test", snippet: query }],
      rawProvider: "exa-mcp",
    }));

    const result = await runAgentTurn({
      model: mockModel([MULTI_TOOL_CALL, FINAL_ANSWER]),
      messages: [{
        role: "user",
        content: "Use web search for latest Apple news and Tesla stock price today",
      }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });

    expect(searchFn).toHaveBeenCalledTimes(2);
    expect(searchFn.mock.calls[0][0]).toBe("Apple news July 2026");
    expect(searchFn.mock.calls[1][0]).toBe("weather Utrecht today");
    expect(result.content).toBe(FINAL_ANSWER);
    expect(result.toolTrace[0].queries).toEqual([
      "Apple news July 2026",
      "weather Utrecht today",
    ]);
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("=== Search 1: Apple news July 2026 ===");
    expect(toolMsg?.content).toContain("=== Search 2: weather Utrecht today ===");
  });

  it("respects abort during generation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAgentTurn({
      model: mockModel(["ignored"]),
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      maxNewTokens: 64,
      signal: controller.signal,
      searchFn: vi.fn(),
    });
    expect(result.aborted).toBe(true);
  });

  it("handles search errors and still returns", async () => {
    const searchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await runAgentTurn({
      model: mockModel([TOOL_CALL, "Recovered after error"]),
      messages: [{ role: "user", content: "q" }],
      tools: [],
      maxNewTokens: 64,
      searchFn,
    });
    expect(result.toolTrace[0].status).toBe("error");
    expect(result.messages.find((m) => m.role === "tool")?.content).toMatch(/Search failed/);
    expect(result.content).toBe("Recovered after error");
  });

  it("attempts synthesis after search even when model keeps emitting tool syntax", async () => {
    const searchFn = vi.fn(async () => ({
      formatted: "results",
      results: [],
      rawProvider: "exa-mcp",
    }));
    const outputs = Array.from({ length: MAX_SEARCH_CALLS + 1 }, (_, i) =>
      `<|tool_call>call:web_search{query:<|"|>query ${i}<|"|>}<tool_call|>`,
    );
    outputs.push(FINAL_ANSWER);
    const result = await runAgentTurn({
      model: mockModel(outputs),
      messages: [{ role: "user", content: "loop" }],
      tools: [],
      maxNewTokens: 64,
      searchFn,
    });
    expect(searchFn).toHaveBeenCalledOnce();
    expect(result.content).toBe(FINAL_ANSWER);
  });

  it("does not run a second search after the first successful one", async () => {
    const searchFn = vi.fn(async () => ({
      formatted: "[1] ESPN\nURL: https://espn.test\nLakers trade news",
      results: [{ id: "1", title: "ESPN", url: "https://espn.test", snippet: "trade" }],
      rawProvider: "exa-mcp",
    }));
    const secondSearch =
      '<|tool_call>call:web_search{query:<|"|>more nba trades<|"|>}<tool_call|>';
    const result = await runAgentTurn({
      model: mockModel([TOOL_CALL, secondSearch, "The Lakers completed a trade yesterday."]),
      messages: [{ role: "user", content: "latest NBA trades" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });
    expect(searchFn).toHaveBeenCalledOnce();
    expect(result.content).toBe("The Lakers completed a trade yesterday.");
  });

  it("forces search for latest-events questions even when model only emits tool syntax", async () => {
    const bare = "call:web_search{query:latest NBA trades}";
    const searchFn = vi.fn(async () => ({
      formatted: "[1] ESPN\nURL: https://espn.test\nLakers trade news",
      results: [{ id: "1", title: "ESPN", url: "https://espn.test", snippet: "trade" }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([bare, "The Lakers completed a trade yesterday."]),
      messages: [{ role: "user", content: "tell me the latest NBA trades" }],
      tools: [],
      maxNewTokens: 128,
      searchFn,
    });
    expect(searchFn).toHaveBeenCalledOnce();
    expect(result.toolTrace).toHaveLength(1);
    expect(result.content).not.toBe(bare);
  });

  it("accumulates synthesis thinking after search", async () => {
    const toolRaw =
      '<|tool_call|>call:web_search{query:<|"|>weather Utrecht<|"|>}';
    const synthRaw =
      "<|channel>thought\nThe results mention rain on Saturday.\n<channel|>\nRain is expected Saturday.";
    const searchFn = vi.fn(async () => ({
      formatted: "[1] Buienradar\nURL: https://buienradar.nl\nRain Saturday",
      results: [{ id: "1", title: "Buienradar", url: "https://buienradar.nl", snippet: "Rain" }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([toolRaw, synthRaw]),
      messages: [{ role: "user", content: "weather in Utrecht — search the web" }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });
    expect(result.thinking).toContain("rain on Saturday");
    expect(result.content).toContain("Rain is expected");
  });

  it("bypasses generation 1 for high-confidence FIFA follow-up", async () => {
    let genCount = 0;
    const searchFn = vi.fn(async () => ({
      formatted: "[1] FIFA\nURL: https://fifa.test\nSpain 2-1 Belgium",
      results: [{
        id: "1",
        title: "Spain 2-1 Belgium",
        url: "https://fifa.test",
        snippet: "Spain beat Belgium 2-1 in the quarterfinal.",
      }],
      rawProvider: "exa-mcp",
    }));
    const model = {
      reset: vi.fn(),
      generate() {
        genCount++;
        const text = "Spain beat Belgium 2-1 in today's match.";
        return (async function* () {
          yield { token: 1, delta: text, text, rawText: text, phase: "decode" };
        })();
      },
    };
    const result = await runAgentTurn({
      model,
      messages: [
        { role: "user", content: "FIFA world cup updates" },
        { role: "assistant", content: "France beat Morocco 2-0." },
        { role: "user", content: "What about the latest match today?" },
      ],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });
    expect(searchFn).toHaveBeenCalledOnce();
    expect(searchFn.mock.calls[0][0].toLowerCase()).toContain("fifa");
    expect(genCount).toBe(1);
    expect(result.content).toContain("Spain");
  });

  it("forces contextual search when model clarifies an obvious FIFA follow-up", async () => {
    const clarification =
      "Please tell me what sport or league you are interested in for the latest match today?";
    const searchFn = vi.fn(async () => ({
      formatted: "[1] FIFA\nURL: https://fifa.test\nSpain 2-1 Belgium",
      results: [{
        id: "1",
        title: "Spain 2-1 Belgium",
        url: "https://fifa.test",
        snippet: "Spain beat Belgium 2-1 in the quarterfinal.",
      }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([clarification, "Spain beat Belgium 2-1 today."]),
      messages: [
        { role: "user", content: "FIFA world cup updates" },
        { role: "assistant", content: "France beat Morocco 2-0." },
        { role: "user", content: "What about the latest match today?" },
      ],
      tools: [],
      maxNewTokens: 128,
      searchFn,
    });
    expect(searchFn).toHaveBeenCalledOnce();
    expect(searchFn.mock.calls[0][0].toLowerCase()).toContain("fifa");
    expect(result.content).toContain("Spain");
  });

  it("does not force search for standalone ambiguous freshness questions", async () => {
    const clarification =
      "Please tell me what sport or league you are interested in for the latest match today?";
    const searchFn = vi.fn();
    const result = await runAgentTurn({
      model: mockModel([clarification]),
      messages: [{ role: "user", content: "What about the latest match today?" }],
      tools: [],
      maxNewTokens: 128,
      searchFn,
    });
    expect(searchFn).not.toHaveBeenCalled();
    expect(result.content).toContain("sport or league");
  });

  it("executes search for malformed <|tool_call|> opener", async () => {
    const raw =
      '<|tool_call|>call:web_search{query:<|"|>weather forecast for Utrecht next couple of days<|"|>}';
    const searchFn = vi.fn(async () => ({
      formatted: "[1] Buienradar\nURL: https://buienradar.nl\nDry and mild",
      results: [{ id: "1", title: "Buienradar", url: "https://buienradar.nl", snippet: "forecast" }],
      rawProvider: "exa-mcp",
    }));
    const result = await runAgentTurn({
      model: mockModel([raw, "Utrecht will be dry and mild over the next few days."]),
      messages: [{
        role: "user",
        content: "What is the weather forecast for utrecht? Search the web and find out",
      }],
      tools: [{ type: "function", function: { name: "web_search" } }],
      maxNewTokens: 128,
      searchFn,
    });
    expect(searchFn).toHaveBeenCalledOnce();
    expect(searchFn.mock.calls[0][0]).toContain("Utrecht");
    expect(result.content).not.toContain("<|tool_call|>");
    expect(result.content).toContain("dry");
  });
});

describe("hasSubstantiveProse", () => {
  it("rejects raw search dumps and tool-only output", () => {
    expect(hasSubstantiveProse("")).toBe(false);
    expect(hasSubstantiveProse(TOOL_CALL)).toBe(false);
    expect(hasSubstantiveProse("[1] Doc\nURL: https://x.test\nsnippet")).toBe(false);
    expect(hasSubstantiveProse("Based on web search results:\n\n[1] Doc")).toBe(false);
    expect(hasSubstantiveProse("The Lakers traded for a center yesterday.")).toBe(true);
  });

  it("rejects clarification-only answers after search", () => {
    expect(hasSubstantiveProse(
      "Please tell me what sport or league you are interested in?",
      "",
      { afterSearch: true },
    )).toBe(false);
  });
});
