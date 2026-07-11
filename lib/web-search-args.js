/** @file Normalize web_search tool arguments (queries array + legacy query). */

/** Max distinct queries per single web_search tool call. */
export const MAX_SEARCH_QUERIES = 3;

/**
 * @param {Record<string, unknown>|null|undefined} args
 * @returns {string[]}
 */
export function normalizeWebSearchQueries(args) {
  if (!args || typeof args !== "object") return [];

  const rawQueries = args.queries;
  if (rawQueries != null) {
    if (Array.isArray(rawQueries)) {
      return dedupeQueries(rawQueries.map((q) => String(q).trim()).filter(Boolean));
    }
    if (typeof rawQueries === "string") {
      const trimmed = rawQueries.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return dedupeQueries(parsed.map((q) => String(q).trim()).filter(Boolean));
          }
        } catch {
          /* fall through */
        }
      }
      return dedupeQueries([trimmed]);
    }
  }

  const legacy = args.query;
  if (typeof legacy === "string" && legacy.trim()) {
    return [legacy.trim()];
  }

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
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_SEARCH_QUERIES) break;
  }
  return out;
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

/**
 * @param {string[]} a
 * @param {string[]} b
 */
export function sameQueries(a, b) {
  const norm = (qs) => dedupeQueries(qs).map((q) => q.toLowerCase()).join("\0");
  return norm(a) === norm(b);
}

/**
 * @param {Record<string, unknown>} args
 * @returns {{ queries: string[] }}
 */
export function normalizeWebSearchArguments(args) {
  return { queries: normalizeWebSearchQueries(args) };
}
