/** @file Format merged results from multiple web searches for model + UI. */

import { formatSearchResultsForModel } from "./search-provider.js";
import { sanitizeExternalText } from "./sanitize.js";

/**
 * @typedef {object} SearchRunResult
 * @property {string} query
 * @property {string} [formatted]
 * @property {object[]} [results]
 * @property {string} [error]
 */

/**
 * @param {SearchRunResult[]} runs
 */
export function formatMultiSearchResultsForModel(runs) {
  if (!runs?.length) return "No results.";

  const parts = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const block = [`=== Search ${i + 1}: ${sanitizeExternalText(run.query || "")} ===`];
    if (run.error) {
      block.push(`Search failed: ${sanitizeExternalText(run.error)}`);
    } else if (run.formatted?.trim()) {
      block.push(sanitizeExternalText(run.formatted.trim()));
    } else {
      block.push(formatSearchResultsForModel(run.results || []) || "No results.");
    }
    parts.push(block.join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * @param {SearchRunResult[]} runs
 */
export function totalResultCount(runs) {
  return runs.reduce((sum, run) => sum + (run.results?.length ?? 0), 0);
}
