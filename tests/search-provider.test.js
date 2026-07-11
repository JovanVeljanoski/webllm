import { describe, expect, it } from "vitest";
import { formatSearchResultsForModel, formatWebSearchEvidence } from "../lib/search-provider.js";

describe("formatSearchResultsForModel", () => {
  it("formats numbered blocks with full snippets by default", () => {
    const results = [
      { id: "1", title: "A", url: "https://a.test", snippet: "aaa" },
      { id: "2", title: "B", url: "https://b.test", snippet: "bbb" },
    ];
    const full = formatSearchResultsForModel(results);
    expect(full).toContain("[1] A");
    expect(full).toContain("URL: https://a.test");
    expect(full).toContain("[2] B");

    const tiny = formatSearchResultsForModel(results, { maxTotalChars: 50 });
    expect(tiny).toContain("[1] A");
    expect(tiny).not.toContain("[2] B");
  });

  it("respects maxResults", () => {
    const results = [
      { id: "1", title: "A", url: "https://a.test", snippet: "aaa" },
      { id: "2", title: "B", url: "https://b.test", snippet: "bbb" },
      { id: "3", title: "C", url: "https://c.test", snippet: "ccc" },
    ];
    const out = formatSearchResultsForModel(results, { maxResults: 2 });
    expect(out).toContain("[1] A");
    expect(out).toContain("[2] B");
    expect(out).not.toContain("[3] C");
  });
});

describe("formatWebSearchEvidence", () => {
  it("uses labeled blocks without URLs", () => {
    const results = [
      {
        id: "1",
        title: "Spain 2-1 Belgium",
        url: "https://fotmob.test/match",
        snippet: "Spain beat Belgium 2-1 in the quarterfinal.",
        publishedAt: "2026-07-10",
      },
    ];
    const evidence = formatWebSearchEvidence("FIFA World Cup latest", results, {
      retrievedAt: "2026-07-11T00:22:10+02:00",
      timezone: "Europe/Amsterdam",
    });
    expect(evidence).toContain("WEB_SEARCH_EVIDENCE");
    expect(evidence).toContain("Query: FIFA World Cup latest");
    expect(evidence).toContain("RESULT 1");
    expect(evidence).toContain("Title: Spain 2-1 Belgium");
    expect(evidence).toContain("Source: fotmob.test");
    expect(evidence).not.toContain("https://");
    expect(evidence).toContain("END_WEB_SEARCH_EVIDENCE");
  });
});
