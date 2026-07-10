import { describe, expect, it } from "vitest";
import { generationErrorFallback, isGenerationAbortError } from "../lib/generation.js";

describe("isGenerationAbortError", () => {
  it("detects AbortError and abort messages", () => {
    expect(isGenerationAbortError({ name: "AbortError" })).toBe(true);
    expect(isGenerationAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isGenerationAbortError({ message: "Request was aborted" })).toBe(true);
    expect(isGenerationAbortError({ message: "CUDA OOM" })).toBe(false);
  });
});

describe("generationErrorFallback", () => {
  it("uses stopped copy for abort without output", () => {
    const result = generationErrorFallback({ name: "AbortError" });
    expect(result.raw).toBe("(stopped)");
    expect(result.toast).toBe("Stopped generating");
  });

  it("preserves partial output and still toasts on abort", () => {
    const result = generationErrorFallback({ name: "AbortError" }, { raw: "partial" });
    expect(result.raw).toBe("partial");
    expect(result.toast).toBe("Stopped generating");
  });

  it("uses error copy for real failures", () => {
    const result = generationErrorFallback({ message: "boom" });
    expect(result.raw).toBe("_Error: boom_");
    expect(result.aborted).toBe(false);
    expect(result.toast).toBe("Generation failed: boom");
  });

  it("keeps partial output on real errors without a toast", () => {
    const result = generationErrorFallback({ message: "boom" }, { raw: "partial" });
    expect(result.raw).toBe("partial");
    expect(result.aborted).toBe(false);
    expect(result.toast).toBeNull();
  });
});
