import { describe, expect, it } from "vitest";
import { computeLoadProgress, labelForLoadStatus } from "../lib/progress.js";
import { MODELS } from "../lib/models.js";

describe("labelForLoadStatus", () => {
  it("maps known load phases", () => {
    expect(labelForLoadStatus("tokenizer")).toBe("Loading tokenizer…");
    expect(labelForLoadStatus("unknown-phase")).toBe("unknown-phase");
  });
});

describe("computeLoadProgress", () => {
  it("maps init/tokenizer phases into progress band", () => {
    const result = computeLoadProgress({ status: "tokenizer", fraction: 0.5 }, MODELS.gemma4);
    expect(result.label).toBe("Loading tokenizer…");
    expect(result.target).toBeCloseTo(0.035, 5);
  });

  it("formats gguf byte progress", () => {
    const result = computeLoadProgress({
      status: "weights",
      fraction: 0.25,
      kind: "bytes",
      loaded: 1024,
      total: 4096,
      fromCache: true,
    }, MODELS.lfm2);
    expect(result.label).toBe("Loading cached weights 1.0 KB/4.0 KB · 25%");
    expect(result.target).toBeCloseTo(0.275, 5);
  });

  it("does not move target on tensor-only safetensors events", () => {
    const result = computeLoadProgress({
      status: "weights",
      kind: "tensors",
      fraction: 0.5,
    }, MODELS.gemma4);
    expect(result.target).toBeNull();
    expect(result.label).toContain("Preparing GPU weights");
  });
});
