/** @file Parse Bonsai / Qwen thinking channels and native tool-call syntax. */

import { normalizeWebSearchQueries } from "./web-search-args.js";
import { sanitizeExternalText } from "./sanitize.js";

const THINKING_OPEN = "<think>";
const THINKING_CLOSE = "</think>";
const TOOL_CALL_OPEN = "<tool_call>";
const TOOL_CALL_CLOSE = "</tool_call>";
const FUNCTION_PREFIX = "<function=";

export function splitBonsaiThinking(raw) {
  const text = raw || "";
  const start = text.indexOf(THINKING_OPEN);
  if (start === -1) {
    return {
      thinking: "",
      output: sanitizeExternalText(text),
    };
  }

  const contentStart = start + THINKING_OPEN.length;
  const end = text.indexOf(THINKING_CLOSE, contentStart);
  if (end === -1) {
    return {
      thinking: sanitizeExternalText(text.slice(contentStart)).trim(),
      output: "",
    };
  }

  const thinking = sanitizeExternalText(text.slice(contentStart, end)).trim();
  const before = text.slice(0, start);
  const after = text.slice(end + THINKING_CLOSE.length).replace(/^\n+/, "");
  return {
    thinking,
    output: sanitizeExternalText(`${before}${after}`.trim()),
  };
}

function hasOpenThinkingChannel(text) {
  const start = text.indexOf(THINKING_OPEN);
  if (start === -1) return false;
  const end = text.indexOf(THINKING_CLOSE, start + THINKING_OPEN.length);
  return end === -1;
}

/**
 * @param {string} body
 * @returns {Record<string, string>}
 */
export function parseXmlParameters(body) {
  return Object.fromEntries(
    parseXmlParameterEntries(body).map(entry => [entry.name, entry.value]),
  );
}

function parseXmlParameterEntries(body) {
  const source = String(body || "");
  const opens = [...source.matchAll(/<parameter=(\w+)>/gi)];
  return opens.map((match, index) => {
    const valueStart = match.index + match[0].length;
    const nextParameter = opens[index + 1]?.index ?? source.length;
    const boundaries = [
      nextParameter,
      source.indexOf("</function>", valueStart),
      source.indexOf("</function_invocation>", valueStart),
      source.indexOf("</tool_call>", valueStart),
      source.indexOf(FUNCTION_PREFIX, valueStart),
    ].filter(position => position >= valueStart);
    const boundary = boundaries.length ? Math.min(...boundaries) : source.length;
    const close = source.indexOf("</parameter>", valueStart);
    const closed = close >= valueStart && close <= boundary;
    const valueEnd = closed ? close : boundary;
    return {
      name: match[1],
      value: source.slice(valueStart, valueEnd).trim(),
      closed,
    };
  });
}

function hasCompleteParameterValue(entry) {
  if (entry.closed) return !!entry.value;
  if (!entry.value) return false;
  try {
    JSON.parse(entry.value);
    return true;
  } catch {
    return false;
  }
}

function parametersFromEntries(entries) {
  const params = {};
  for (const entry of entries) {
    params[entry.name] = entry.value;
  }
  return params;
}

function parseParameterValue(paramName, rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";
  const parsed = tryParseJson(trimmed);
  if (paramName === "queries") {
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "string") {
      return normalizeWebSearchQueries({ queries: parsed });
    }
    return normalizeWebSearchQueries({ queries: trimmed });
  }
  return parsed ?? trimmed;
}

function tryParseJson(text) {
  if (!text.startsWith("[") && !text.startsWith("{")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeArguments(name, params) {
  const args = {};
  for (const [key, value] of Object.entries(params)) {
    args[key] = parseParameterValue(key, value);
  }
  if (name === "web_search" && !args.queries?.length && args.query) {
    args.queries = normalizeWebSearchQueries({ query: args.query });
    delete args.query;
  }
  if (name === "web_search" && Array.isArray(args.queries)) {
    args.queries = normalizeWebSearchQueries({ queries: args.queries });
  }
  return args;
}

function consumeTrailingToolClosers(source, end) {
  const tail = source.slice(end);
  const match = tail.match(
    /^(?:\s*<\/(?:parameter|function|function_invocation|tool_call)>)+/i,
  );
  return end + (match?.[0].length || 0);
}

function scanToolCallCandidates(text, toolNames = null, { strict = false } = {}) {
  const source = String(text || "");
  const allowed = toolNames ? new Set(toolNames) : null;
  const functionPattern = /<function=(\w+)>/gi;
  const candidates = [];
  let match;

  while ((match = functionPattern.exec(source)) !== null) {
    const name = match[1];
    const functionStart = match.index;
    const previousOpen = source.lastIndexOf(TOOL_CALL_OPEN, functionStart);
    const previousClose = source.lastIndexOf(TOOL_CALL_CLOSE, functionStart);
    const wrapperStart = previousOpen > previousClose ? previousOpen : -1;
    if (strict && wrapperStart === -1) continue;

    const nextFunction = source.indexOf(FUNCTION_PREFIX, functionPattern.lastIndex);
    const wrapperClose = source.indexOf(TOOL_CALL_CLOSE, functionPattern.lastIndex);
    const hasWrapperClose =
      wrapperStart !== -1
      && wrapperClose !== -1
      && (nextFunction === -1 || wrapperClose < nextFunction);
    const blockEnd = hasWrapperClose
      ? wrapperClose + TOOL_CALL_CLOSE.length
      : (nextFunction === -1 ? source.length : nextFunction);
    const end = consumeTrailingToolClosers(source, blockEnd);
    const block = source.slice(functionStart, blockEnd);
    const parameterEntries = parseXmlParameterEntries(block);
    const complete =
      parameterEntries.length > 0
      && parameterEntries.every(hasCompleteParameterValue);

    if (!allowed || allowed.has(name)) {
      candidates.push({
        name,
        arguments: normalizeArguments(
          name,
          parametersFromEntries(parameterEntries),
        ),
        complete,
        startIndex: wrapperStart === -1 ? functionStart : wrapperStart,
        endIndex: end,
      });
    }

    if (end > functionPattern.lastIndex) functionPattern.lastIndex = end;
  }

  return candidates;
}

/**
 * @param {string} text
 * @param {boolean} [strict]
 * @param {string[]} [toolNames]
 */
export function extractBonsaiToolCalls(text, strict = false, toolNames = ["web_search"]) {
  return scanToolCallCandidates(text, toolNames, { strict })
    .filter(candidate => candidate.complete)
    .map(candidate => ({
      name: candidate.name,
      arguments: candidate.arguments,
    }));
}

export function parseBonsaiToolOutput(raw, toolNames = ["web_search"]) {
  const text = raw || "";
  const { thinking, output } = splitBonsaiThinking(text);
  if (hasOpenThinkingChannel(text)) {
    return { thinking, content: output, toolCalls: [], truncated: false };
  }

  const candidates = scanToolCallCandidates(output, toolNames);
  const toolCalls = candidates
    .filter(candidate => candidate.complete)
    .map(candidate => ({
      name: candidate.name,
      arguments: candidate.arguments,
    }));
  const truncated = candidates.some(candidate => !candidate.complete);
  const content = stripBonsaiToolCallSyntax(output, toolNames);
  return { thinking, content, toolCalls, truncated };
}

export function looksLikeBonsaiToolCallSyntax(text) {
  const source = String(text || "");
  if (source.includes(TOOL_CALL_OPEN) || source.includes(FUNCTION_PREFIX)) {
    return true;
  }
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("<")) return false;
  return [TOOL_CALL_OPEN, FUNCTION_PREFIX]
    .some(marker => marker.startsWith(trimmed));
}

export function stripBonsaiToolCallSyntax(text, _toolNames = ["web_search"]) {
  const source = text || "";
  const ranges = scanToolCallCandidates(source)
    .map(candidate => ({
      start: candidate.startIndex,
      end: candidate.endIndex,
    }));

  if (!ranges.length) return source.trim();

  ranges.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    out += source.slice(cursor, range.start);
    cursor = range.end;
  }
  return (out + source.slice(cursor)).trim();
}

function formatParameterValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** @param {object[]} toolCalls */
export function renderBonsaiToolCalls(toolCalls) {
  return (toolCalls || []).map(call => {
    const name = call.function?.name || call.name;
    const args = parseCallArguments(call.function?.arguments ?? call.arguments);
    const params = Object.entries(args).map(([key, value]) => (
      `<parameter=${key}>\n${formatParameterValue(value)}\n</parameter>`
    )).join("\n");
    return `<tool_call>\n<function=${name}>\n${params}\n</tool_call>`;
  }).join("\n");
}

function parseCallArguments(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { queries: value };
    }
  }
  return value || {};
}
