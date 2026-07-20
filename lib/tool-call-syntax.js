/** @file Shared Gemma tool-call brace scanning and completion detection. */

export const ESCAPE_TOKEN = '<|"|>';
const THOUGHT_OPENERS = ["<|channel>thought", "<|think|>"];
const THOUGHT_CLOSER = "<channel|>";

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
  let quoted = false;
  let escaped = false;
  for (let i = openBraceIdx; i < text.length; i++) {
    if (text.startsWith(ESCAPE_TOKEN, i)) {
      const close = text.indexOf(ESCAPE_TOKEN, i + ESCAPE_TOKEN.length);
      if (close === -1) return -1;
      i = close + ESCAPE_TOKEN.length - 1;
      continue;
    }
    const char = text[i];
    if (char === "\\" && quoted) {
      escaped = !escaped;
      continue;
    }
    if (char === '"' && !escaped) {
      quoted = !quoted;
      continue;
    }
    escaped = false;
    if (quoted) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {string} argsStr
 * @returns {Record<string, unknown>}
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

  /** @type {Record<string, unknown>} */
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
  for (const m of cleaned.matchAll(
    /(\w+):\s*(-?\d+(?:\.\d+)?|true|false|null)(?=\s*(?:,|$))/gi,
  )) {
    const value = m[2].toLowerCase();
    if (value === "true" || value === "false") args[m[1]] = value === "true";
    else if (value === "null") args[m[1]] = null;
    else args[m[1]] = Number(m[2]);
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
 * @returns {{ start: number, end: number, closed: boolean, openEnd: number, closeEnd: number }[]}
 */
export function getThoughtChannelRanges(text) {
  const src = text || "";
  const tokens = [];
  for (const opener of THOUGHT_OPENERS) {
    let index = src.indexOf(opener);
    while (index !== -1) {
      tokens.push({ index, type: "open", length: opener.length });
      index = src.indexOf(opener, index + opener.length);
    }
  }
  let index = src.indexOf(THOUGHT_CLOSER);
  while (index !== -1) {
    tokens.push({ index, type: "close", length: THOUGHT_CLOSER.length });
    index = src.indexOf(THOUGHT_CLOSER, index + THOUGHT_CLOSER.length);
  }
  tokens.sort((a, b) => a.index - b.index || (a.type === "close" ? 1 : -1));

  const ranges = [];
  let open = null;
  for (const token of tokens) {
    if (token.type === "open") {
      if (!open) {
        open = {
          start: token.index,
          openEnd: token.index + token.length,
        };
      }
      continue;
    }
    if (!open) continue;
    ranges.push({
      start: open.start,
      end: token.index + token.length,
      closed: true,
      openEnd: open.openEnd,
      closeEnd: token.index + token.length,
    });
    open = null;
  }
  if (open) {
    ranges.push({
      start: open.start,
      end: src.length,
      closed: false,
      openEnd: open.openEnd,
      closeEnd: src.length,
    });
  }
  return ranges;
}

/**
 * @param {string} text
 */
export function hasUnclosedThoughtChannel(text) {
  return getThoughtChannelRanges(text).some(range => !range.closed);
}

/**
 * @param {{ start: number, end: number }[]} ranges
 * @param {number} index
 */
function isInsideThoughtChannel(ranges, index) {
  return ranges.some(
    range => index >= range.start && index < range.end,
  );
}

/**
 * @param {string} text
 * @param {string[]} toolNames
 * @returns {{ name: string, startIndex: number }[]}
 */
export function findToolCallStarts(text, toolNames = ["web_search"]) {
  const src = text || "";
  const thoughtRanges = getThoughtChannelRanges(src);
  const starts = [];
  for (const toolName of toolNames) {
    const re = toolOpenerRegex(toolName);
    let match;
    while ((match = re.exec(src)) !== null) {
      if (!isInsideThoughtChannel(thoughtRanges, match.index)) {
        starts.push({
          name: toolName,
          startIndex: match.index,
        });
      }
    }
  }
  return starts.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * @param {string} text
 * @param {string[]} toolNames
 * @returns {{ name: string, arguments: Record<string, string>, startIndex: number, endIndex: number }[]}
 */
export function findCompleteToolCalls(text, toolNames = ["web_search"]) {
  const src = text || "";
  const thoughtRanges = getThoughtChannelRanges(src);
  const calls = [];
  for (const toolName of toolNames) {
    const re = toolOpenerRegex(toolName);
    let match;
    while ((match = re.exec(src)) !== null) {
      if (isInsideThoughtChannel(thoughtRanges, match.index)) continue;
      const braceIdx = match.index + match[0].length - 1;
      const closeBrace = scanBalancedBraces(src, braceIdx);
      if (closeBrace === -1) continue;

      const args = parseToolCallArguments(src.slice(braceIdx + 1, closeBrace));
      let endIndex = closeBrace + 1;
      const tail = src.slice(endIndex);
      const term = tail.match(/^\s*(?:<tool_call\|>|<turn\|>)?/);
      if (term?.[0]) endIndex += term[0].length;

      calls.push({
        name: toolName,
        arguments: args,
        startIndex: match.index,
        endIndex,
      });
    }
  }
  return calls.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * @param {string} text
 * @param {string[]} toolNames
 * @returns {{ name: string, arguments: Record<string, string>, startIndex: number, endIndex: number } | null}
 */
export function findCompleteToolCall(text, toolNames = ["web_search"]) {
  return findCompleteToolCalls(text, toolNames)[0] || null;
}

/** @param {string} text @param {string[]} [toolNames] */
export function hasCompleteToolCall(text, toolNames = ["web_search"]) {
  return findCompleteToolCall(text, toolNames) != null;
}
