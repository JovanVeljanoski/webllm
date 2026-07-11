import { describe, expect, it } from "vitest";
import {
  dedupeQueries,
  formatQueriesLabel,
  normalizeWebSearchQueries,
  sameQueries,
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
});

describe("formatQueriesLabel", () => {
  it("joins multiple queries for display", () => {
    expect(formatQueriesLabel(["Apple news", "Utrecht weather"]))
      .toBe("Apple news · Utrecht weather");
  });
});

describe("sameQueries", () => {
  it("compares query sets case-insensitively", () => {
    expect(sameQueries(["Apple"], ["apple"])).toBe(true);
    expect(sameQueries(["Apple", "B"], ["B", "Apple"])).toBe(false);
  });
});
