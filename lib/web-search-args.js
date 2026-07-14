/** @file Normalize web_search tool arguments (queries array + legacy query). */

import { sanitizeExternalText } from "./sanitize.js";

/** Max distinct queries per single web_search tool call. */
export const MAX_SEARCH_QUERIES = 3;
/** Keep external search requests bounded even if the model emits a long string. */
export const MAX_SEARCH_QUERY_LENGTH = 256;

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanQuery(value) {
  return sanitizeExternalText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH);
}

/**
 * @param {Record<string, unknown>|null|undefined} args
 * @returns {string[]}
 */
export function normalizeWebSearchQueries(args) {
  if (!args || typeof args !== "object") return [];

  const rawQueries = args.queries;
  if (rawQueries != null) {
    if (Array.isArray(rawQueries)) {
      return dedupeQueries(rawQueries.map(cleanQuery).filter(Boolean));
    }
    if (typeof rawQueries === "string") {
      const trimmed = rawQueries.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return dedupeQueries(parsed.map(cleanQuery).filter(Boolean));
          }
        } catch {
          /* fall through */
        }
      }
      return dedupeQueries([cleanQuery(trimmed)]);
    }
  }

  const legacy = args.query;
  if (typeof legacy === "string") return dedupeQueries([cleanQuery(legacy)]);

  return [];
}

/**
 * @param {string[]} queries
 * @returns {string[]}
 */
export function dedupeQueries(queries) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const q of queries) {
    const cleaned = cleanQuery(q);
    if (!cleaned) continue;
    const key = searchQueryKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_SEARCH_QUERIES) break;
  }
  return out;
}

/**
 * Normalize superficial request phrasing for duplicate suppression.
 *
 * @param {string} query
 * @returns {string}
 */
export function searchQueryKey(query) {
  return cleanQuery(query)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^(?:please\s+)?(?:tell me|can you|could you|what is|what are)\s+/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string[]} queries
 * @returns {string}
 */
export function formatQueriesLabel(queries) {
  if (!queries?.length) return "";
  if (queries.length === 1) return queries[0];
  return queries.join(" · ");
}
