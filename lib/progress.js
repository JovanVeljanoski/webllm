/** @file Model load progress label/target computation (pure). */

import { LOAD_PHASE } from "./constants.js";
import { fmtBytes } from "./format.js";

export function labelForLoadStatus(status) {
  return ({
    init: "Requesting WebGPU…",
    tokenizer: "Loading tokenizer…",
    weights: "Downloading weights…",
    ready: "Model ready",
  })[status] || status;
}

/**
 * Pure progress update from a runtime onProgress event.
 * @returns {{ target: number, label: string }}
 */
export function computeLoadProgress(event, def, phases = LOAD_PHASE) {
  if (event.status !== "weights") {
    const [lo, hi] = phases[event.status] || [0, 1];
    const f = Number.isFinite(event.fraction) ? Math.min(1, Math.max(0, event.fraction)) : 0;
    const label = `${labelForLoadStatus(event.status)}${event.message ? " · " + event.message : ""}`;
    return { target: lo + (hi - lo) * f, label };
  }

  const frac = Number.isFinite(event.fraction) ? Math.min(1, Math.max(0, event.fraction)) : null;

  if (def.cacheType === "gguf") {
    let label = "Preparing GPU weights…";
    if (event.kind === "bytes") {
      const verb = event.fromCache ? "Loading cached weights" : "Downloading weights";
      const lr = event.loaded != null && event.total != null
        ? ` ${fmtBytes(event.loaded)}/${fmtBytes(event.total)}`
        : "";
      label = `${verb}${lr}${frac != null ? ` · ${Math.round(frac * 100)}%` : ""}`;
    } else if (frac != null) {
      label = `Preparing GPU weights · ${Math.round(frac * 100)}%`;
    }
    return { target: 0.05 + 0.90 * (frac ?? 0), label };
  }

  let label = "Preparing GPU weights…";
  if (event.kind === "bytes") {
    const verb = event.fromCache ? "Loading cached weights" : "Downloading weights";
    const lr = event.loaded != null && event.total != null
      ? ` ${fmtBytes(event.loaded)}/${fmtBytes(event.total)}`
      : "";
    label = `${verb}${lr}${frac != null ? ` · ${Math.round(frac * 100)}%` : ""}`;
  }

  const target = event.kind !== "tensors" ? 0.05 + 0.95 * (frac ?? 0) : null;
  return { target, label };
}
