import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GenerationTracker, appendThinkingTrace } from "../lib/generation-tracker.js";

describe("GenerationTracker", () => {
  /** @type {import('vitest').MockInstance} */
  let nowSpy;

  beforeEach(() => {
    let now = 0;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    nowSpy._advance = (ms) => { now += ms; };
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("measures TTFT from generation start to first token", () => {
    const tracker = new GenerationTracker();
    nowSpy._advance(100);
    tracker.onPrefillStart({ prefillTokens: 120 });
    nowSpy._advance(2000);
    tracker.onPrefillDone({ prefillTokens: 120 });
    nowSpy._advance(300);
    tracker.onToken();
    const snap = tracker.snapshot();
    expect(snap.prefillTokens).toBe(120);
    expect(Number(snap.prefillSec)).toBeCloseTo(2.0, 1);
    expect(Number(snap.ttft)).toBeCloseTo(2.4, 1);
  });

  it("excludes idle time before resetGeneration", () => {
    const tracker = new GenerationTracker();
    nowSpy._advance(5000);
    tracker.resetGeneration();
    nowSpy._advance(500);
    tracker.onToken();
    expect(Number(tracker.snapshot().ttft)).toBeCloseTo(0.5, 1);
  });
});

describe("appendThinkingTrace", () => {
  it("joins multi-step traces with separators", () => {
    let acc = "";
    acc = appendThinkingTrace(acc, "plan search", { label: "Planning" });
    acc = appendThinkingTrace(acc, "summarize", { label: "Synthesis" });
    expect(acc).toContain("Planning");
    expect(acc).toContain("summarize");
    expect(acc).toContain("---");
  });

  it("replaces duplicate label sections instead of stacking them", () => {
    let acc = appendThinkingTrace("", "first", { label: "Synthesis" });
    acc = appendThinkingTrace(acc, "second", { label: "Synthesis" });
    expect(acc).toBe("Synthesis\nsecond");
  });
});
