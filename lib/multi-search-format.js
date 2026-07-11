/** @file Format merged results from multiple web searches for model + UI. */

import { formatSearchResultsForModel } from "./search-provider.js";

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
    parts.push(`=== Search ${i + 1}: ${run.query} ===`);
    if (run.error) {
      parts.push(`Search failed: ${run.error}`);
    } else if (run.formatted?.trim()) {
      parts.push(run.formatted.trim());
    } else {
      parts.push(formatSearchResultsForModel(run.results || []) || "No results.");
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

/**
 * @param {SearchRunResult[]} runs
 */
export function totalResultCount(runs) {
  return runs.reduce((sum, run) => sum + (run.results?.length ?? 0), 0);
}
