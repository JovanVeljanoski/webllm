/** @file Search provider interface. */

import { sanitizeExternalText } from "./sanitize.js";

/**
 * @typedef {object} SearchResult
 * @property {string} id
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 * @property {string|null} [publishedAt]
 */

/** Default number of Exa results fetched and shown (user + model see the same payload). */
export const SEARCH_MAX_RESULTS = 3;

/**
 * Shared search payload for UI bubble and model tool message (identical text).
 * @param {SearchResult[]} results
 * @param {{ maxTotalChars?: number|null, maxResults?: number }} [options]
 */
export function formatSearchResultsForModel(results, options = {}) {
  const rows = Array.isArray(results) ? results : [];
  const maxTotalChars = options.maxTotalChars ?? null;
  const limit = Math.min(options.maxResults ?? rows.length, rows.length);
  const parts = [];
  let used = 0;
  for (let i = 0; i < limit; i++) {
    const r = rows[i] || {};
    const title = sanitizeExternalText(r.title || `Source ${i + 1}`)
      .replace(/\s+/g, " ");
    const url = String(r.url || "").trim().replace(/\s+/g, "");
    const snippet = sanitizeExternalText(r.snippet || "")
      .replace(/\s+/g, " ");
    const block = `[${i + 1}] ${title || `Source ${i + 1}`}\nURL: ${url}\n${snippet}`.trim();
    if (maxTotalChars != null && used + block.length > maxTotalChars) {
      const remaining = maxTotalChars - used;
      if (remaining > 80) parts.push(block.slice(0, remaining).trimEnd());
      break;
    }
    parts.push(block);
    used += block.length + 2;
  }
  return parts.join("\n\n");
}
