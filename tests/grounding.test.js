import { describe, expect, it } from "vitest";
import { appearsGrounded, extractEvidenceAnchors } from "../lib/grounding.js";

const EVIDENCE = `
WEB_SEARCH_EVIDENCE
Query: latest FIFA World Cup match results July 11 2026

RESULT 1
Title: Spain 2-1 Belgium; Spain advances to face France
Published: 2026-07-10
Source: FotMob
Text: Spain beat Belgium 2-1. Mikel Merino capitalized on a goalkeeper error.

RESULT 2
Title: France beats Morocco 2-0
Published: 2026-07-10
Source: Newswav
Text: Kylian Mbappé and Ousmane Dembélé scored as France advanced.
END_WEB_SEARCH_EVIDENCE
`;

describe("appearsGrounded", () => {
  it("accepts answers with strong evidence anchors", () => {
    expect(appearsGrounded(
      "Spain beat Belgium 2-1 and will face France next.",
      EVIDENCE,
      "latest FIFA World Cup match results July 11 2026",
    )).toBe(true);
  });

  it("rejects clarification-only answers", () => {
    expect(appearsGrounded(
      "A specific sport?\nA specific league?\nA specific tournament?",
      EVIDENCE,
      "latest match today",
    )).toBe(false);
  });

  it("extracts score and entity anchors", () => {
    const { strongAnchors } = extractEvidenceAnchors(EVIDENCE, "latest match today");
    expect(strongAnchors.some(a => /2-1|2-0/.test(a))).toBe(true);
    expect(strongAnchors.some(a => /Spain|France/i.test(a))).toBe(true);
  });
});
