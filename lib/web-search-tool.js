/** @file Web search tool implementation for the generic agent loop. */

import { WEB_SEARCH_TOOL_SPEC } from "./tools.js";
import {
  formatQueriesLabel,
  normalizeWebSearchQueries,
  searchQueryKey,
} from "./web-search-args.js";
import {
  formatMultiSearchResultsForModel,
  totalResultCount,
} from "./multi-search-format.js";
import { sanitizeExternalText } from "./sanitize.js";

export function createWebSearchTool(searchProvider) {
  const searchedQueryKeys = new Set();

  return {
    ...WEB_SEARCH_TOOL_SPEC,

    async execute(args, { signal } = {}) {
      const requestedQueries = normalizeWebSearchQueries(args);
      const queries = requestedQueries.filter(
        query => !searchedQueryKeys.has(searchQueryKey(query)),
      );
      for (const query of queries) searchedQueryKeys.add(searchQueryKey(query));

      if (!queries.length) {
        return {
          content: "Skipped duplicate web_search query; use the existing result above.",
          meta: {
            query: formatQueriesLabel(requestedQueries),
            queries: requestedQueries,
            provider: "exa-mcp",
            resultCount: 0,
            status: "skipped",
          },
        };
      }

      const providers = new Set();
      const started = performance.now();
      const runs = await Promise.all(queries.map(async query => {
        try {
          const result = await searchProvider.search(query, {
            signal,
            maxResults: 3,
          });
          if (result.rawProvider) providers.add(result.rawProvider);
          return {
            query,
            formatted: result.formatted || "No results.",
            results: result.results ?? [],
          };
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") throw error;
          return {
            query,
            error: error instanceof Error ? error.message : String(error),
            results: [],
          };
        }
      }));

      const resultCount = totalResultCount(runs);
      const status = runs.some(run => run.error)
        ? (runs.every(run => run.error) ? "error" : "partial")
        : "ok";
      return {
        content: sanitizeExternalText(formatMultiSearchResultsForModel(runs)),
        meta: {
          query: formatQueriesLabel(queries),
          queries,
          provider: [...providers].join(",") || "exa-mcp",
          resultCount,
          status,
          durationMs: Math.round(performance.now() - started),
        },
      };
    },
  };
}
