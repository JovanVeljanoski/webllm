import { describe, expect, it } from "vitest";
import { formatMultiSearchResultsForModel, totalResultCount } from "../lib/multi-search-format.js";

describe("formatMultiSearchResultsForModel", () => {
  it("merges multiple search runs with section headers", () => {
    const text = formatMultiSearchResultsForModel([
      {
        query: "Apple news",
        formatted: "[1] Apple\nURL: https://apple.test\nHeadline",
        results: [{ id: "1" }],
      },
      {
        query: "Utrecht weather",
        formatted: "[1] Buienradar\nURL: https://buien.test\nSunny",
        results: [{ id: "1" }],
      },
    ]);
    expect(text).toContain("=== Search 1: Apple news ===");
    expect(text).toContain("=== Search 2: Utrecht weather ===");
    expect(text).toContain("Headline");
    expect(text).toContain("Sunny");
  });

  it("includes per-query errors", () => {
    const text = formatMultiSearchResultsForModel([
      { query: "A", formatted: "ok", results: [] },
      { query: "B", error: "network down", results: [] },
    ]);
    expect(text).toContain("Search failed: network down");
  });

  it("sums result counts", () => {
    expect(totalResultCount([
      { query: "A", results: [{ id: "1" }, { id: "2" }] },
      { query: "B", results: [{ id: "1" }] },
    ])).toBe(3);
  });
});
