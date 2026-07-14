import { describe, expect, it } from "vitest";
import {
  dedupeQueries,
  formatQueriesLabel,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeWebSearchQueries,
  searchQueryKey,
} from "../lib/web-search-args.js";

describe("normalizeWebSearchQueries", () => {
  it("reads queries array", () => {
    expect(normalizeWebSearchQueries({
      queries: ["Apple news", "Utrecht weather"],
    })).toEqual(["Apple news", "Utrecht weather"]);
  });

  it("supports legacy single query field", () => {
    expect(normalizeWebSearchQueries({ query: "  Berlin weather  " })).toEqual(["Berlin weather"]);
  });

  it("parses JSON string queries", () => {
    expect(normalizeWebSearchQueries({
      queries: '["Apple news", "Utrecht weather"]',
    })).toEqual(["Apple news", "Utrecht weather"]);
  });

  it("dedupes and caps queries", () => {
    expect(dedupeQueries([
      "A",
      "a",
      "B",
      "C",
      "D",
    ])).toEqual(["A", "B", "C"]);
  });

  it("strips control tokens and bounds query length", () => {
    const query = normalizeWebSearchQueries({
      query: `<|tool_call>${"x".repeat(MAX_SEARCH_QUERY_LENGTH + 20)}`,
    })[0];
    expect(query).not.toContain("<|tool_call>");
    expect(query).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
  });
});

describe("formatQueriesLabel", () => {
  it("joins multiple queries for display", () => {
    expect(formatQueriesLabel(["Apple news", "Utrecht weather"]))
      .toBe("Apple news · Utrecht weather");
  });
});

describe("searchQueryKey", () => {
  it("normalizes superficial request phrasing for duplicate keys", () => {
    expect(searchQueryKey("Tell me the latest NBA trades"))
      .toBe(searchQueryKey("latest NBA trades"));
  });
});
