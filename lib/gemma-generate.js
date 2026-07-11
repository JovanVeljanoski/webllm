/** @file Helpers for Gemma4Mobile.generate() in agent loops. */

import { hasCompleteToolCall } from "./tool-call-syntax.js";

/**
 * @param {object} options
 * @param {string} rawText
 */
function shouldStopForToolCall(options, rawText) {
  if (options.stopMode === "tool_call" && options.stopToolNames?.length) {
    return hasCompleteToolCall(rawText, options.stopToolNames);
  }
  if (options.stopOnToolCall) {
    return hasCompleteToolCall(rawText, options.stopToolNames || ["web_search"]);
  }
  return false;
}

/**
 * @param {object} chunk
 * @returns {boolean}
 */
export function isPrefillChunk(chunk) {
  return chunk?.phase === "prefill";
}

/**
 * @param {object} model - Gemma4Mobile instance
 * @param {object[]} messages
 * @param {object} options
 * @param {(chunk: object) => void} [onStream]
 * @returns {Promise<{ rawText: string, text: string, tokens: number, stopReason: string|null, metrics: object|null }>}
 */
export async function generateToCompletion(model, messages, options, onStream) {
  const stream = model.generate(messages, options);
  let text = "";
  let rawText = "";
  let tokens = 0;
  /** @type {string|null} */
  let stopReason = null;
  /** @type {object|null} */
  let metrics = null;

  for await (const chunk of stream) {
    onStream?.(chunk);

    if (isPrefillChunk(chunk)) {
      if (chunk.status === "done" && options.tracker) {
        options.tracker.onPrefillStart(chunk);
        options.tracker.onPrefillDone(chunk);
      } else if (chunk.status === "start" && options.tracker) {
        options.tracker.onPrefillStart(chunk);
      }
      continue;
    }

    tokens++;
    if (options.tracker) options.tracker.onToken();
    if (chunk.text != null) text = chunk.text;
    if (chunk.rawText != null) rawText = chunk.rawText;
    else rawText = text;

    if (options.signal?.aborted) {
      stopReason = "abort";
      break;
    }

    if (shouldStopForToolCall(options, rawText)) {
      stopReason = "tool_call";
      break;
    }
  }

  if (options.tracker) {
    metrics = options.tracker.snapshot();
  }

  return {
    rawText: rawText || text,
    text,
    tokens,
    stopReason: stopReason || null,
    metrics,
  };
}
