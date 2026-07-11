/** @file Exa MCP search provider (zero-config, no API key). */

import { SearchProvider, formatSearchResultsForModel, SEARCH_MAX_RESULTS } from "./search-provider.js";
import { sanitizeExternalText } from "./sanitize.js";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

/**
 * @param {string} body
 * @returns {object|null}
 */
export function parseMcpSseBody(body) {
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.result || parsed?.error) return parsed;
    } catch {
      /* try next line */
    }
  }
  try {
    const parsed = JSON.parse(body.trim());
    if (parsed?.result || parsed?.error) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{ title: string, url: string, snippet: string }[]}
 */
export function parseExaMcpResultText(text) {
  const blocks = text.split(/(?=^Title: )/m).filter((b) => b.trim());
  return blocks
    .map((block) => {
      const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
      const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
      let snippet = "";
      const textStart = block.indexOf("\nText: ");
      if (textStart >= 0) {
        snippet = block.slice(textStart + 7).trim();
      } else {
        const hl = block.match(/\nHighlights:\s*\n/);
        if (hl?.index != null) snippet = block.slice(hl.index + hl[0].length).trim();
      }
      snippet = snippet.replace(/\n---\s*$/, "").trim();
      return { title, url, snippet: sanitizeExternalText(snippet) };
    })
    .filter((r) => r.url.length > 0);
}

export class ExaMcpSearchProvider extends SearchProvider {
  /** @type {string} */
  #url;

  constructor(url = EXA_MCP_URL) {
    super();
    this.#url = url;
  }

  /**
   * @param {string} query
   * @param {{ signal?: AbortSignal, maxResults?: number, maxTotalChars?: number }} [options]
   */
  async search(query, options = {}) {
    const maxResults = options.maxResults ?? SEARCH_MAX_RESULTS;
    const response = await fetch(this.#url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query: String(query).trim(),
            numResults: maxResults,
            livecrawl: "fallback",
            type: "auto",
            contextMaxCharacters: 3000,
          },
        },
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Exa MCP HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const body = await response.text();
    const parsed = parseMcpSseBody(body);
    if (!parsed) throw new Error("Exa MCP returned empty response");
    if (parsed.error) {
      throw new Error(parsed.error.message || "Exa MCP error");
    }
    if (parsed.result?.isError) {
      const msg = parsed.result.content?.find((c) => c.type === "text")?.text;
      throw new Error(msg || "Exa MCP tool error");
    }

    const text = parsed.result?.content?.find(
      (c) => c.type === "text" && typeof c.text === "string" && c.text.trim(),
    )?.text;
    if (!text) throw new Error("Exa MCP returned no content");

    const rows = parseExaMcpResultText(text);
    const results = rows.map((r, i) => ({
      id: String(i + 1),
      title: r.title || `Source ${i + 1}`,
      url: r.url,
      snippet: r.snippet,
      publishedAt: null,
    }));

    return {
      results,
      formatted: formatSearchResultsForModel(results, {
        maxResults,
        maxTotalChars: options.maxTotalChars ?? null,
      }),
      rawProvider: "exa-mcp",
    };
  }
}

/** Default singleton for app use. */
export const defaultSearchProvider = new ExaMcpSearchProvider();
