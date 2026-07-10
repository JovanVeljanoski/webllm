/** @file UI state helpers (labels, cache status text). */

import { fmtBytes } from "./format.js";

export function loadButtonLabel({ model, loading, modelCached, fileOrigin, isHero }) {
  if (model) return "Model ready";
  if (loading) return "Loading…";
  if (isHero && modelCached && !fileOrigin) return "Start";
  return "Load model";
}

export function formatAllModelsCacheStatus({ stored, declared, modelCount }) {
  if (modelCount === 0) return "No models cached yet";
  const modelLabel = modelCount === 1 ? "1 model" : `${modelCount} models`;
  if (stored > 0) {
    if (declared && stored < declared * 0.9) {
      return `Cached · ~${fmtBytes(stored)} from ${modelLabel} (~${fmtBytes(declared)} total)`;
    }
    return `Cached · ~${fmtBytes(stored)} from ${modelLabel}`;
  }
  return `Cached · ${modelLabel}`;
}

export function isCacheCapable({ fileOrigin, caches, indexedDB, models }) {
  if (fileOrigin || !caches) return false;
  return Object.values(models).some(def =>
    def.cacheType !== "gguf" ? !!indexedDB : true);
}

export function clampMaxNewTokens(value, { min = 64, max = 8192, fallback = 4096 } = {}) {
  const n = parseInt(value, 10);
  const resolved = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, resolved));
}
