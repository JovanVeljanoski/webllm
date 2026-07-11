/** @file Single-line status text for one active generation phase. */

import { formatPrefillStats, formatStreamStats } from "./format.js";

/**
 * One status string for the current phase (search → prefill → decode/thinking).
 * @param {object} opts
 */
export function formatActivePhaseStatus({
  streamPhase = "generating",
  prefillActive = false,
  prefillTokens = 0,
  prefillSec = null,
  cachedTokens = 0,
  searchStartedAt = 0,
  tokCount = 0,
  tps = 0,
  ttft = null,
  now = performance.now(),
} = {}) {
  if (streamPhase === "searching") {
    const elapsed = searchStartedAt
      ? ((now - searchStartedAt) / 1000).toFixed(1)
      : "…";
    return `Web search · ${elapsed}s`;
  }
  if (streamPhase === "prefill" || prefillActive) {
    return formatPrefillStats({
      prefillTokens,
      prefillSec,
      cachedTokens,
      active: prefillActive || streamPhase === "prefill",
    });
  }
  if (tokCount > 0 || ttft != null) {
    return formatStreamStats({ tokCount, tps, ttft });
  }
  return "Thinking…";
}

/**
 * Label for the thinking disclosure header during streaming.
 * @param {object} opts
 */
export function formatThinkPanelLabel(opts) {
  const { streamPhase, displayThinking, tokCount } = opts;
  if (streamPhase === "searching") return "Searching the web…";
  if (streamPhase === "prefill" || opts.prefillActive) {
    return formatActivePhaseStatus(opts);
  }
  if (displayThinking && tokCount > 0) return "Thinking…";
  if (displayThinking) return "Thinking…";
  return formatActivePhaseStatus(opts);
}
