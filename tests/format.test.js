import { describe, expect, it } from "vitest";
import {
  esc,
  fmtBytes,
  formatStreamStats,
  formatPrefillStats,
  formatTime,
  sessionDownloadFilename,
  statsLine,
  thinkLabel,
} from "../lib/format.js";

describe("esc", () => {
  it("escapes HTML special characters", () => {
    expect(esc('<script>"\'&')).toBe("&lt;script&gt;&quot;&#39;&amp;");
  });

  it("handles nullish values", () => {
    expect(esc(null)).toBe("");
  });
});

describe("fmtBytes", () => {
  it("formats bytes through gigabytes", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(5_242_880)).toBe("5.0 MB");
  });
});

describe("formatTime", () => {
  it("shows time for today and date otherwise", () => {
    const now = new Date("2026-07-10T15:30:00");
    const todayTs = new Date("2026-07-10T09:15:00").getTime();
    const olderTs = new Date("2026-06-01T09:15:00").getTime();
    expect(formatTime(todayTs, now)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatTime(olderTs, now)).toMatch(/Jun/);
  });
});

describe("sessionDownloadFilename", () => {
  it("slugifies titles safely", () => {
    expect(sessionDownloadFilename("Hello World!")).toBe("Hello-World.json");
    expect(sessionDownloadFilename("   ")).toBe("conversation.json");
  });
});

describe("stream and stats helpers", () => {
  it("formatStreamStats joins token metrics", () => {
    expect(formatStreamStats({ tokCount: 12, tps: 40, ttft: "0.8" }))
      .toBe("12 tok · 40 tok/s · TTFT 0.8s");
  });

  it("thinkLabel prefers timing metadata", () => {
    expect(thinkLabel({ ttft: "1.2" }, "")).toBe("Thought for 1.2s");
    expect(thinkLabel(null, "trace")).toBe("Show thinking");
  });

  it("statsLine renders footer stats", () => {
    expect(statsLine({ tokens: 8, tps: "12.0", ttft: "0.5" }))
      .toBe("8 tok · 12.0 tok/s · TTFT 0.5s");
    expect(statsLine({
      tokens: 40,
      tps: "10.0",
      ttft: "3.4",
      prefillTokens: 820,
      prefillSec: "3.1",
    })).toBe("Prefill 820 tok · 3.1s · 40 tok · 10.0 tok/s · TTFT 3.4s");
  });

  it("formatPrefillStats shows active prefill", () => {
    expect(formatPrefillStats({ prefillTokens: 500, active: true }))
      .toBe("Prefill · 500 tok · …");
  });
});
