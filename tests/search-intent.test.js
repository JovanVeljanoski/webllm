import { describe, expect, it } from "vitest";
import { inferSearchQuery, lastUserMessageText, looksLikeMultiTopicSearch, userWantsWebSearch } from "../lib/search-intent.js";

describe("userWantsWebSearch", () => {
  it("detects explicit search requests", () => {
    expect(userWantsWebSearch("Please search the web for Berlin weather")).toBe(true);
    expect(userWantsWebSearch("Use web_search to find GPU news")).toBe(true);
  });

  it("detects freshness questions", () => {
    expect(userWantsWebSearch("What happened in the news today?")).toBe(true);
    expect(userWantsWebSearch("tell me the latest NBA trades")).toBe(true);
  });

  it("returns false for generic chat", () => {
    expect(userWantsWebSearch("Explain recursion")).toBe(false);
  });
});

describe("inferSearchQuery", () => {
  it("strips polite prefixes", () => {
    expect(inferSearchQuery("Please search the web for Berlin weather today")).toBe(
      "Berlin weather today",
    );
  });

  it("adds recent FIFA context for follow-up questions", () => {
    const q = inferSearchQuery("What about the latest match today?", {
      recentMessages: [
        { role: "user", content: "FIFA world cup updates" },
        { role: "assistant", content: "Spain beat Belgium." },
      ],
    });
    expect(q).toMatch(/FIFA World Cup/i);
    expect(q).toContain("latest match today");
  });
});

describe("looksLikeMultiTopicSearch", () => {
  it("detects compound questions", () => {
    expect(looksLikeMultiTopicSearch(
      "What are the latest Apple news, and what is the weather today in Utrecht?",
    )).toBe(true);
    expect(looksLikeMultiTopicSearch("Latest Apple news and Tesla stock price")).toBe(true);
  });

  it("returns false for single-topic requests", () => {
    expect(looksLikeMultiTopicSearch("Latest Apple news")).toBe(false);
    expect(looksLikeMultiTopicSearch("Weather in Utrecht today")).toBe(false);
  });
});

describe("lastUserMessageText", () => {
  it("returns the latest user turn", () => {
    expect(
      lastUserMessageText([
        { role: "user", content: "first" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "second" },
      ]),
    ).toBe("second");
  });
});
