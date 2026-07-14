/** @file Parse Gemma 4 E2B thinking and tool-call syntax. */

import {
  findCompleteToolCalls,
  findToolCallStarts,
  getThoughtChannelRanges,
  hasUnclosedThoughtChannel,
} from "./tool-call-syntax.js";
import {
  looksLikeLfmToolCallSyntax,
  stripLfmToolCallSyntax,
} from "./lfm-tool-parser.js";
import { sanitizeExternalText } from "./sanitize.js";

export { hasUnclosedThoughtChannel } from "./tool-call-syntax.js";

/**
 * @param {string} argsStr
 * @returns {Record<string, string>}
 */
export { parseToolCallArguments } from "./tool-call-syntax.js";

export function splitThinking(raw) {
  const text = raw || "";
  const first = getThoughtChannelRanges(text)[0];
  let thinking = "";
  let output = text;
  if (first) {
    const before = text.slice(0, first.start);
    if (first.closed) {
      const closerLength = "<channel|>".length;
      thinking = text.slice(first.openEnd, first.closeEnd - closerLength).trim();
      output = (text.slice(first.closeEnd).replace(/^\n+/, "") + before).trim();
    } else {
      thinking = text.slice(first.openEnd).trim();
      output = "";
    }
  }
  return {
    thinking,
    output: sanitizeExternalText(
      output
        .replace(/<\|channel>thought/g, "")
        .replace(/<\|think\|>/g, "")
        .replace(/<channel\|>/g, "")
        .replace(/^\n+/, ""),
    ),
  };
}

/**
 * @param {string} text
 * @param {boolean} [strict]
 * @param {string[]} [toolNames]
 * @returns {{ name: string, arguments: Record<string, string> }[]}
 */
export function extractGemmaToolCalls(text, strict = false, toolNames = ["web_search"]) {
  const src = text || "";
  if (strict && !/<\|tool_call\|?>/.test(src)) return [];
  return findCompleteToolCalls(src, toolNames).map(({ name, arguments: args }) => ({
    name,
    arguments: args,
  }));
}

/**
 * @param {string} raw
 * @param {string[]} [toolNames]
 * @returns {{ thinking: string, content: string, toolCalls: { name: string, arguments: object }[], truncated: boolean }}
 */
export function parseGemmaToolOutput(raw, toolNames = ["web_search"]) {
  const text = raw || "";
  const { thinking, output } = splitThinking(text);
  const toolCalls = extractGemmaToolCalls(text, false, toolNames);

  const starts = findToolCallStarts(text, toolNames);
  const complete = findCompleteToolCalls(text, toolNames);
  const truncated = starts.length > complete.length;
  if (hasUnclosedThoughtChannel(text)) {
    return { thinking, content: output, toolCalls: [], truncated: false };
  }

  return { thinking, content: output, toolCalls, truncated };
}

/** @param {string} text */
export function looksLikeToolCallSyntax(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (looksLikeLfmToolCallSyntax(t)) return true;
  if (/<\|tool(?:_call)?(?:\|?>?)?/.test(t)) return true;
  if (/^call:[a-zA-Z_]\w*$/.test(t)) return true;
  return /(?:<\|tool_call(?:\|)?>|\bcall:)?[a-zA-Z_]\w*\{/.test(t);
}

/** @param {string} text @param {string[]} [toolNames] */
export function stripToolCallSyntax(text, toolNames = ["web_search"]) {
  const src = stripLfmToolCallSyntax(text || "");
  const complete = findCompleteToolCalls(src, toolNames);
  const starts = findToolCallStarts(src, toolNames);
  const ranges = complete.map(call => ({
    start: call.startIndex,
    end: call.endIndex,
  }));
  for (const start of starts) {
    if (!ranges.some(range => start.startIndex >= range.start && start.startIndex < range.end)) {
      ranges.push({ start: start.startIndex, end: src.length });
    }
  }
  if (!ranges.length) return src.trim();

  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  let out = "";
  let cursor = 0;
  for (const range of merged) {
    out += src.slice(cursor, range.start);
    cursor = range.end;
  }
  return (out + src.slice(cursor)).trim();
}
