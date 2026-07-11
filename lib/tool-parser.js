/** @file Parse Gemma 4 E2B tool-call syntax from model output. */

import { splitThinking } from "./messages.js";
import {
  findCompleteWebSearchCall,
  parseToolCallArguments,
} from "./tool-call-syntax.js";
import { normalizeWebSearchQueries } from "./web-search-args.js";

const TOOL_END = "(?:<tool_call\\|>|<turn\\|>|$)";

/** Tier 1: standard special-token wrapper (optional call: prefix). */
const STANDARD_TOOL_RE = new RegExp(
  `<\\|tool_call\\|?>(?:call:)?(\\w+)\\{(.*?)\\}${TOOL_END}`,
  "gs",
);

/** Tier 2: bare call:name{args} without wrapper (known Gemma 4 variation). */
const FALLBACK_TOOL_RE = /(?:^|[\s>])(?:call:)?(\w+)\{(.*?)\}(?:\s|$|<turn\|>|$)/gs;

const THOUGHT_OPENERS = ["<|channel>thought", "<|think|>"];

/**
 * @param {string} argsStr
 * @returns {Record<string, string>}
 */
export { parseToolCallArguments } from "./tool-call-syntax.js";

/**
 * @param {string} text
 * @param {boolean} [strict]
 * @returns {{ name: string, arguments: Record<string, string> }[]}
 */
export function extractGemmaToolCalls(text, strict = false) {
  const src = text || "";
  /** @type {{ name: string, arguments: Record<string, string> }[]} */
  const results = [];

  STANDARD_TOOL_RE.lastIndex = 0;
  let m;
  while ((m = STANDARD_TOOL_RE.exec(src)) !== null) {
    results.push({
      name: m[1],
      arguments: parseToolCallArguments(m[2]),
    });
  }
  if (results.length || strict) return results;

  FALLBACK_TOOL_RE.lastIndex = 0;
  while ((m = FALLBACK_TOOL_RE.exec(src)) !== null) {
    results.push({
      name: m[1],
      arguments: parseToolCallArguments(m[2]),
    });
  }
  if (results.length || strict) return results;

  const complete = findCompleteWebSearchCall(src);
  if (complete) {
    results.push({
      name: complete.name,
      arguments: complete.arguments,
    });
  }
  return results;
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function hasUnclosedThoughtChannel(raw) {
  const text = raw || "";
  let openIdx = -1;
  let openLen = 0;
  for (const op of THOUGHT_OPENERS) {
    const i = text.indexOf(op);
    if (i !== -1 && (openIdx === -1 || i < openIdx)) {
      openIdx = i;
      openLen = op.length;
    }
  }
  if (openIdx === -1) return false;
  const after = text.slice(openIdx + openLen);
  return !after.includes("<channel|>");
}

/**
 * @param {string} raw
 * @returns {{ thinking: string, content: string, toolCalls: { name: string, arguments: { queries: string[] } }[], truncated: boolean }}
 */
export function parseGemmaToolOutput(raw) {
  const text = raw || "";
  const { thinking, output } = splitThinking(text);
  const scanText =
    /(?:<\|tool_call(?:\|)?>|\bcall:\w+\{)/.test(text) ? text : output;

  const extracted = extractGemmaToolCalls(scanText);
  /** @type {{ name: string, arguments: { queries: string[] } }[]} */
  const toolCalls = [];
  for (const tc of extracted) {
    const queries = normalizeWebSearchQueries(tc.arguments);
    if (tc.name === "web_search" && queries.length) {
      toolCalls.push({ name: "web_search", arguments: { queries } });
    }
  }

  if (toolCalls.length) {
    return { thinking, content: output, toolCalls, truncated: false };
  }

  if (hasUnclosedThoughtChannel(text)) {
    return { thinking, content: output, toolCalls: [], truncated: false };
  }

  const truncated =
    /(?:<\|tool_call(?:\|)?>|\bcall:\w+\{)/.test(scanText) &&
    toolCalls.length === 0 &&
    !findCompleteWebSearchCall(scanText);

  return { thinking, content: output, toolCalls, truncated };
}

/**
 * @param {{ name: string, arguments: { queries?: string[], query?: string } }[]} toolCalls
 * @returns {{ name: string, arguments: { queries: string[] } } | null}
 */
export function firstValidWebSearchCall(toolCalls) {
  for (const tc of toolCalls) {
    if (tc.name !== "web_search") continue;
    const queries = normalizeWebSearchQueries(tc.arguments);
    if (queries.length) return { name: "web_search", arguments: { queries } };
  }
  return null;
}

/** @param {string} text */
export function looksLikeToolCallSyntax(text) {
  const t = (text || "").trim();
  if (!t) return false;
  return /(?:<\|tool_call(?:\|)?>|\bcall:)?web_search\{/.test(t);
}

/** @param {string} text */
export function isToolCallOnlyText(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (looksLikeToolCallSyntax(t) && findCompleteWebSearchCall(t)) {
    const stripped = stripToolCallSyntax(t);
    return stripped.length === 0;
  }
  const calls = extractGemmaToolCalls(t);
  if (!calls.some((c) => c.name === "web_search")) return false;
  return stripToolCallSyntax(t).length === 0;
}

/** @param {string} text */
export function stripToolCallSyntax(text) {
  return (text || "")
    .replace(/<\|tool_call\|?>[\s\S]*?(?:<tool_call\|>|<turn\|>|$)/g, "")
    .replace(/(?:^|[\s>])(?:call:)?web_search\{[^}]*(?:<\|"\|>[^}]*?)*\}/g, "")
    .trim();
}

/**
 * Collect web_search calls from multiple text fragments (raw, thinking, content).
 * @param {string} raw
 * @param {{ thinking?: string, content?: string }} [parts]
 */
export function collectWebSearchCalls(raw, parts = {}) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ name: string, arguments: { queries: string[] } }[]} */
  const out = [];
  const sources = [raw, parts.thinking, parts.content].filter(Boolean);
  for (const src of sources) {
    for (const tc of parseGemmaToolOutput(src).toolCalls) {
      const queries = tc.arguments?.queries || [];
      const key = queries.map((q) => q.toLowerCase()).join("\0");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tc);
    }
  }
  return out;
}
