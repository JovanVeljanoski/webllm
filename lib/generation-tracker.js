/** @file Per-generation latency metrics (prefill, TTFT, decode). */

/**
 * Tracks one model.generate() call. Search / network waits are excluded —
 * call resetGeneration() when a new generate() begins.
 */
export class GenerationTracker {
  constructor() {
    this.resetGeneration();
  }

  resetGeneration() {
    this.genStartedAt = performance.now();
    this.prefillStartedAt = null;
    this.prefillDoneAt = null;
    this.firstTokenAt = null;
    /** @type {number} */
    this.prefillTokens = 0;
    /** @type {number} */
    this.cachedTokens = 0;
    /** @type {number} */
    this.promptTokens = 0;
    this.generatedTokens = 0;
  }

  /** @param {object} info */
  onPrefillStart(info = {}) {
    if (this.prefillStartedAt == null) this.prefillStartedAt = performance.now();
    if (info.prefillTokens != null) this.prefillTokens = info.prefillTokens;
    if (info.cachedTokens != null) this.cachedTokens = info.cachedTokens;
    if (info.promptTokens != null) this.promptTokens = info.promptTokens;
    if (info.promptTokensTotal != null && !this.promptTokens) {
      this.promptTokens = info.promptTokensTotal;
    }
  }

  /** @param {object} [info] */
  onPrefillDone(info = {}) {
    if (this.prefillDoneAt == null) this.prefillDoneAt = performance.now();
    if (info.prefillTokens != null) this.prefillTokens = info.prefillTokens;
  }

  onToken() {
    if (this.firstTokenAt == null) this.firstTokenAt = performance.now();
    this.generatedTokens++;
  }

  /** @returns {number|null} seconds */
  getPrefillSec() {
    if (this.prefillStartedAt == null) return null;
    const end = this.prefillDoneAt ?? this.firstTokenAt ?? performance.now();
    return (end - this.prefillStartedAt) / 1000;
  }

  /** Time from generate() start to first output token (includes prefill). */
  getTtftSec() {
    if (this.genStartedAt == null || this.firstTokenAt == null) return null;
    return (this.firstTokenAt - this.genStartedAt) / 1000;
  }

  /** Decode tok/s after first token. */
  getDecodeTps() {
    if (this.firstTokenAt == null || this.generatedTokens <= 1) return 0;
    const decodeSec = Math.max((performance.now() - this.firstTokenAt) / 1000, 1e-9);
    return Math.round((this.generatedTokens - 1) / decodeSec);
  }

  /** @returns {object} */
  snapshot() {
    const prefillSec = this.getPrefillSec();
    const ttftSec = this.getTtftSec();
    return {
      prefillTokens: this.prefillTokens,
      cachedTokens: this.cachedTokens,
      promptTokens: this.promptTokens,
      generatedTokens: this.generatedTokens,
      prefillSec: prefillSec != null ? prefillSec.toFixed(1) : null,
      ttft: ttftSec != null ? ttftSec.toFixed(1) : null,
      tps: String(this.getDecodeTps()),
      tokens: this.generatedTokens,
    };
  }
}

/**
 * Merge thinking traces across agent generations.
 * @param {string} accumulated
 * @param {string} next
 * @param {{ generation?: number, label?: string }} [ctx]
 */
export function appendThinkingTrace(accumulated, next, ctx = {}) {
  const chunk = (next || "").trim();
  if (!chunk) return accumulated;
  const header = ctx.label || (ctx.generation ? `Step ${ctx.generation}` : "");
  const block = header ? `${header}\n${chunk}` : chunk;
  if (!accumulated) return block;

  if (header) {
    const sep = "\n\n---\n\n";
    const parts = accumulated.split(sep);
    const idx = parts.findIndex((p) => p.startsWith(`${header}\n`) || p === header);
    if (idx !== -1) {
      parts[idx] = block;
      return parts.join(sep);
    }
  }

  return `${accumulated}\n\n---\n\n${block}`;
}
