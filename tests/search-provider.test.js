import { describe, expect, it } from "vitest";
import { formatSearchResultsForModel } from "../lib/search-provider.js";

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

describe("formatSearchResultsForModel safety", () => {
  it("strips model control tokens without shortening external fields", () => {
    const out = formatSearchResultsForModel([{
      title: "<|tool_call>unsafe",
      url: "https://example.test/" + "a".repeat(3000),
      snippet: "<|channel> " + "word ".repeat(500),
    }]);
    expect(out).not.toContain("<|tool_call>");
    expect(out).not.toContain("<|channel>");
    expect(out).toContain("a".repeat(3000));
    expect(out).toContain("word ".repeat(499).trim());
  });
});
