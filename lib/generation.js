/** @file Generation error classification. */

export function isGenerationAbortError(err) {
  return err?.name === "AbortError" || String(err?.message || "").toLowerCase().includes("abort");
}

export function generationErrorFallback(err, { raw = "" } = {}) {
  const aborted = isGenerationAbortError(err);
  if (raw) {
    return { raw, aborted, toast: aborted ? "Stopped generating" : null };
  }
  return {
    raw: aborted ? "(stopped)" : `_Error: ${err?.message || err}_`,
    aborted,
    toast: aborted ? "Stopped generating" : `Generation failed: ${err?.message || err}`,
  };
}
