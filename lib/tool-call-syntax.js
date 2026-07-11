/** @file Shared Gemma tool-call brace scanning and completion detection. */

import { normalizeWebSearchQueries } from "./web-search-args.js";

export const ESCAPE_TOKEN = '<|"|>';

/**
 * @param {unknown} value
 */
function normalizeParsedArgValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

/**
 * @param {string} text
 * @param {number} openBraceIdx
 * @returns {number}
 */
export function scanBalancedBraces(text, openBraceIdx) {
  if (text[openBraceIdx] !== "{") return -1;
  let depth = 0;
  for (let i = openBraceIdx; i < text.length; i++) {
    if (text.startsWith(ESCAPE_TOKEN, i)) {
      const close = text.indexOf(ESCAPE_TOKEN, i + ESCAPE_TOKEN.length);
      if (close === -1) return -1;
      i = close + ESCAPE_TOKEN.length - 1;
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {string} argsStr
 * @returns {Record<string, string | string[]>}
 */
export function parseToolCallArguments(argsStr) {
  if (!argsStr?.trim()) return {};

  const cleaned = argsStr.replaceAll(ESCAPE_TOKEN, '"');
  try {
    const parsed = JSON.parse(`{${cleaned}}`);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, normalizeParsedArgValue(v)]),
      );
    }
  } catch {
    /* fall through */
  }

  /** @type {Record<string, string | string[]>} */
  const args = {};
  const arrayMatch = cleaned.match(/queries:\s*\[([\s\S]*)\]/);
  if (arrayMatch) {
    const items = [];
    for (const m of arrayMatch[1].matchAll(/"([^"]*)"/g)) {
      if (m[1]?.trim()) items.push(m[1].trim());
    }
    if (items.length) args.queries = items;
  }

  for (const m of cleaned.matchAll(/(\w+):\s*"([^"]*)"/g)) {
    if (m[1] === "queries" && args.queries) continue;
    args[m[1]] = m[2];
  }
  if (Object.keys(args).length) return args;

  for (const m of argsStr.matchAll(/(\w+):\s*([^,}]+)/g)) {
    if (m[1] === "queries") continue;
    args[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "").replaceAll(ESCAPE_TOKEN, "");
  }
  return args;
}

/**
 * @param {string} text
 * @param {string} toolName
 * @returns {RegExp}
 */
function toolOpenerRegex(toolName) {
  const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:<\\|tool_call\\|?>(?:call:)?|\\b(?:call:)?)${escaped}\\{`, "g");
}

/**
 * @param {string} text
 * @param {string[]} toolNames
 * @returns {{ name: string, arguments: Record<string, string>, endIndex: number } | null}
 */
export function findCompleteToolCall(text, toolNames = ["web_search"]) {
  const src = text || "";
  /** @type {{ name: string, arguments: Record<string, string>, endIndex: number } | null} */
  let best = null;

  for (const toolName of toolNames) {
    const re = toolOpenerRegex(toolName);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const braceIdx = m.index + m[0].length - 1;
      const closeBrace = scanBalancedBraces(src, braceIdx);
      if (closeBrace === -1) continue;

      const args = parseToolCallArguments(src.slice(braceIdx + 1, closeBrace));
      let endIndex = closeBrace + 1;
      const tail = src.slice(endIndex);
      const term = tail.match(/^\s*(?:<tool_call\|>|<turn\|>)?/);
      if (term?.[0]) endIndex += term[0].length;

      if (!best || endIndex > best.endIndex) {
        best = { name: toolName, arguments: args, endIndex };
      }
    }
  }

  return best;
}

/** @param {string} text @param {string[]} [toolNames] */
export function hasCompleteToolCall(text, toolNames = ["web_search"]) {
  return findCompleteToolCall(text, toolNames) != null;
}

/** @param {string} text */
export function findCompleteWebSearchCall(text) {
  const hit = findCompleteToolCall(text, ["web_search"]);
  if (!hit) return null;
  const queries = normalizeWebSearchQueries(hit.arguments);
  if (!queries.length) return null;
  return { ...hit, arguments: { queries } };
}

/** @param {string} text */
export function hasCompleteWebSearchToolCall(text) {
  return findCompleteWebSearchCall(text) != null;
}
