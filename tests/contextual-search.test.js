import { describe, expect, it } from "vitest";
import {
  resolveContextualFreshnessQuery,
  shouldBypassGenerationOne,
} from "../lib/contextual-search.js";

describe("resolveContextualFreshnessQuery", () => {
  it("enriches FIFA follow-up with bypass eligibility", () => {
    const messages = [
      { role: "user", content: "What are the latest FIFA World Cup results?" },
      { role: "assistant", content: "France beat Morocco 2-0." },
      { role: "user", content: "What about the latest match today?" },
    ];
    const routed = resolveContextualFreshnessQuery(
      "What about the latest match today?",
      messages,
    );
    expect(routed.freshnessIntentConfidence).toBeGreaterThanOrEqual(0.9);
    expect(routed.referentResolutionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(routed.canBypassGenerationOne).toBe(true);
    expect(routed.query.toLowerCase()).toContain("fifa");
  });

  it("marks standalone ambiguous freshness as low confidence", () => {
    const routed = resolveContextualFreshnessQuery("What about the latest match today?", [
      { role: "user", content: "What about the latest match today?" },
    ]);
    expect(routed.referentResolutionConfidence).toBeLessThan(0.5);
    expect(routed.canBypassGenerationOne).toBe(false);
    expect(routed.ambiguous).toBe(true);
  });

  it("treats multi-topic history as ambiguous even with freshness", () => {
    const messages = [
      { role: "user", content: "Latest NBA scores" },
      { role: "assistant", content: "Lakers won." },
      { role: "user", content: "Latest NFL scores" },
      { role: "assistant", content: "Chiefs won." },
      { role: "user", content: "What about today?" },
    ];
    const routed = resolveContextualFreshnessQuery("What about today?", messages);
    expect(routed.ambiguous).toBe(true);
    expect(routed.canBypassGenerationOne).toBe(false);
  });

  it("allows bypass for explicit weather referent with freshness", () => {
    const routed = resolveContextualFreshnessQuery(
      "What is the weather in Utrecht right now?",
      [{ role: "user", content: "What is the weather in Utrecht right now?" }],
    );
    expect(routed.canBypassGenerationOne).toBe(true);
    expect(shouldBypassGenerationOne(
      "What is the weather in Utrecht right now?",
      [{ role: "user", content: "What is the weather in Utrecht right now?" }],
    )).toBe(true);
  });
});
