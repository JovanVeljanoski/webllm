/** @file Search provider interface. */

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

export class SearchProvider {
  /** @returns {Promise<SearchResult[]>} */
  async search(_query, _options) {
    throw new Error("SearchProvider.search not implemented");
  }
}

/**
 * @param {string} query
 * @param {SearchResult[]} results
 * @param {{ retrievedAt?: string, timezone?: string, maxTotalChars?: number, maxResults?: number }} [options]
 */
export function formatWebSearchEvidence(query, results, options = {}) {
  const maxTotalChars = options.maxTotalChars ?? 1800;
  const maxResults = Math.min(options.maxResults ?? 3, results?.length ?? 0);
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const timezone = options.timezone ?? "UTC";

  const lines = [
    "WEB_SEARCH_EVIDENCE",
    `Query: ${String(query || "").trim()}`,
    `Retrieved: ${retrievedAt}`,
    `User timezone: ${timezone}`,
    "",
  ];

  let used = lines.join("\n").length;
  for (let i = 0; i < maxResults; i++) {
    const r = results[i];
    const snippet = (r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 420);
    const block = [
      `RESULT ${i + 1}`,
      `Title: ${(r.title || `Source ${i + 1}`).trim()}`,
      r.publishedAt ? `Published: ${r.publishedAt}` : null,
      `Source: ${hostnameFromUrl(r.url)}`,
      snippet ? `Text: ${snippet}` : null,
      "",
    ].filter(Boolean).join("\n");
    if (used + block.length > maxTotalChars) break;
    lines.push(block);
    used += block.length;
  }

  lines.push("END_WEB_SEARCH_EVIDENCE");
  return lines.join("\n");
}

/** @param {string} [url] */
function hostnameFromUrl(url) {
  try {
    return new URL(url || "").hostname.replace(/^www\./, "") || "web";
  } catch {
    return "web";
  }
}

/**
 * @param {SearchResult[]} results
 * @param {number} [maxTotalChars]
 */
export function compactResultsForModel(results, maxTotalChars = 2200) {
  return formatWebSearchEvidence("", results || [], { maxTotalChars, maxResults: 4 });
}

/**
 * Shared search payload for UI bubble and model tool message (identical text).
 * @param {SearchResult[]} results
 * @param {{ maxTotalChars?: number|null, maxResults?: number }} [options]
 */
export function formatSearchResultsForModel(results, options = {}) {
  const maxTotalChars = options.maxTotalChars ?? null;
  const limit = Math.min(options.maxResults ?? results.length, results?.length ?? 0);
  const parts = [];
  let used = 0;
  for (let i = 0; i < limit; i++) {
    const r = results[i];
    const block = `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`.trim();
    if (maxTotalChars != null && used + block.length > maxTotalChars) break;
    parts.push(block);
    used += block.length + 2;
  }
  return parts.join("\n\n");
}
