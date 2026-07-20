/** @file Generation error classification. */

export function isGenerationAbortError(err) {
  return err?.name === "AbortError" || String(err?.message || "").toLowerCase().includes("abort");
}

function generationFailureCopy(err) {
  const technicalMessage = String(err?.message || err);
  const contextMatch = technicalMessage.match(
    /current turn requires ([\d,]+) input tokens, but this model allows ([\d,]+) after reserving output space/i,
  );
  if (contextMatch) {
    const [, required, available] = contextMatch;
    return {
      message:
        `This turn is too large for the model (${required} input tokens; ${available} available). `
        + "Use grep or read a smaller range, or start a new conversation.",
      toast: "This turn is too large for the model. Use a smaller file range.",
    };
  }

  if (/No supported WebGPU variant for\s+\S+/i.test(technicalMessage)) {
    return {
      message:
        "The model could not process this prompt because its WebGPU runtime has no compatible "
        + "kernel for this input shape. This is not necessarily a context-window overflow. "
        + "Try grep first or read a smaller range, such as 50–100 lines.",
      toast: "WebGPU could not process this prompt shape. Try a smaller file range.",
    };
  }

  return {
    message: technicalMessage,
    toast: `Generation failed: ${technicalMessage}`,
  };
}

export function generationErrorFallback(err, { raw = "" } = {}) {
  const aborted = isGenerationAbortError(err);
  const failure = aborted ? null : generationFailureCopy(err);
  if (raw) {
    return {
      raw,
      aborted,
      toast: aborted ? "Stopped generating" : failure.toast,
    };
  }
  return {
    raw: aborted ? "(stopped)" : `_Error: ${failure.message}_`,
    aborted,
    toast: aborted ? "Stopped generating" : failure.toast,
  };
}
