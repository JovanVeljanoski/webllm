import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatActivePhaseStatus, formatThinkPanelLabel } from "../lib/phase-status.js";

describe("formatActivePhaseStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only search status while searching", () => {
    expect(formatActivePhaseStatus({
      streamPhase: "searching",
      searchStartedAt: 9000,
      tokCount: 12,
      tps: 40,
      now: 10_000,
    })).toBe("Web search · 1.0s");
  });

  it("shows only prefill status during prefill", () => {
    expect(formatActivePhaseStatus({
      streamPhase: "prefill",
      prefillActive: true,
      prefillTokens: 800,
      tokCount: 3,
    })).toBe("Prefill · 800 tok · …");
  });

  it("shows decode stats after prefill completes", () => {
    expect(formatActivePhaseStatus({
      streamPhase: "generating",
      prefillTokens: 800,
      prefillSec: "2.1",
      tokCount: 12,
      tps: 18,
      ttft: "2.3",
    })).toBe("12 tok · 18 tok/s · TTFT 2.3s");
  });

  it("shows immediate stopping feedback", () => {
    expect(formatActivePhaseStatus({
      streamPhase: "stopping",
      tokCount: 12,
    })).toBe("Stopping…");
  });
});

describe("formatThinkPanelLabel", () => {
  it("uses a single phase-specific label", () => {
    expect(formatThinkPanelLabel({
      streamPhase: "searching",
      searchStartedAt: performance.now(),
    })).toBe("Searching the web…");
  });
});
