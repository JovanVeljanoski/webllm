import { describe, expect, it } from "vitest";
import {
  buildSearchMemory,
  extractFactsFromAnswer,
  findRelevantSearchMemoryBlock,
  formatSearchMemoryBlock,
} from "../lib/search-memory.js";

describe("search memory", () => {
  it("extracts short factual sentences", () => {
    const facts = extractFactsFromAnswer("Spain beat Belgium 2-1. France beat Morocco 2-0.");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]).toContain("Spain");
  });

  it("formats delimited memory block", () => {
    const block = formatSearchMemoryBlock({
      query: "latest FIFA World Cup results",
      retrievedAt: "2026-07-10T22:20:00Z",
      topic: "FIFA World Cup",
      facts: ["Spain beat Belgium 2-1.", "France beat Morocco 2-0."],
    });
    expect(block).toContain("PREVIOUS_SEARCH_CONTEXT");
    expect(block).toContain("END_PREVIOUS_SEARCH_CONTEXT");
    expect(block).not.toContain("http");
  });

  it("injects memory for relevant follow-ups", () => {
    const session = {
      messages: [
        {
          role: "assistant",
          content: "Spain beat Belgium 2-1.",
          searchMemory: buildSearchMemory({
            query: "FIFA World Cup latest",
            topic: "FIFA World Cup",
            content: "Spain beat Belgium 2-1. France beat Morocco 2-0.",
            retrievedAt: "2026-07-10T22:20:00Z",
          }),
        },
        { role: "user", content: "What about Spain?" },
      ],
    };
    const block = findRelevantSearchMemoryBlock(session, "What about Spain?");
    expect(block).toContain("Spain beat Belgium");
  });
});
