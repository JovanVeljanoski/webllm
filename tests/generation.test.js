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

  it("explains context overflows with token counts and recovery options", () => {
    const result = generationErrorFallback(new RangeError(
      "The current turn requires 140000 input tokens, but this model allows "
      + "130752 after reserving output space.",
    ));
    expect(result.raw).toContain("140000 input tokens; 130752 available");
    expect(result.raw).toContain("read a smaller range");
    expect(result.toast).toContain("too large");
  });

  it("turns WebGPU variant failures into an actionable prompt-shape error", () => {
    const result = generationErrorFallback(new Error(
      "No supported WebGPU variant for com.xenova.gemma4.DenseGemv; "
      + "rejected scalar: when guard resolved to false",
    ));
    expect(result.raw).toContain("no compatible kernel for this input shape");
    expect(result.raw).toContain("not necessarily a context-window overflow");
    expect(result.raw).toContain("50–100 lines");
    expect(result.toast).toContain("smaller file range");
  });

  it("keeps partial output and surfaces real failures in a toast", () => {
    const result = generationErrorFallback({ message: "boom" }, { raw: "partial" });
    expect(result.raw).toBe("partial");
    expect(result.aborted).toBe(false);
    expect(result.toast).toBe("Generation failed: boom");
  });
});
