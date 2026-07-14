import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../lib/web-search-tool.js";

describe("createWebSearchTool", () => {
  it("normalizes, deduplicates, and formats search results", async () => {
    const search = vi.fn(async query => ({
      rawProvider: "exa-mcp",
      formatted: `1. ${query}\nhttps://example.com`,
      results: [{ title: query }],
    }));
    const tool = createWebSearchTool({ search });

    const first = await tool.execute({
      queries: ["Scores", "scores", "Weather"],
    });
    const duplicate = await tool.execute({ query: " scores " });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][1]).not.toHaveProperty("maxTotalChars");
    expect(first.content).toContain("Scores");
    expect(first.meta).toMatchObject({
      queries: ["Scores", "Weather"],
      provider: "exa-mcp",
      resultCount: 2,
      status: "ok",
    });
    expect(duplicate.meta.status).toBe("skipped");
  });

  it("returns partial failures as tool results", async () => {
    const tool = createWebSearchTool({
      search: vi.fn(async query => {
        if (query === "bad") throw new Error("network");
        return { formatted: "ok result", results: [{}] };
      }),
    });

    const result = await tool.execute({ queries: ["good", "bad"] });
    expect(result.meta.status).toBe("partial");
    expect(result.content).toContain("network");
  });
});
