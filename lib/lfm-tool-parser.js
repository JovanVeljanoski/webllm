/** @file Parse and render Liquid LFM2.5 native tool-call syntax. */

const CALL_START = "<|tool_call_start|>";
const CALL_END = "<|tool_call_end|>";

function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  const stack = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (pairs[char]) stack.push(pairs[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (!stack.length && char === separator) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function topLevelIndex(text, target) {
  let quote = "";
  let escaped = false;
  const stack = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (pairs[char]) stack.push(pairs[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (!stack.length && char === target) return index;
  }
  return -1;
}

function parseQuotedString(text) {
  const quote = text[0];
  let value = "";
  for (let index = 1; index < text.length - 1; index++) {
    const char = text[index];
    if (char !== "\\") {
      value += char;
      continue;
    }
    const escaped = text[++index];
    const replacements = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    value += replacements[escaped] ?? escaped ?? "";
  }
  return quote && text.at(-1) === quote ? value : text;
}

function parseLiteral(source) {
  const text = source.trim();
  if (!text) return "";
  if ((text[0] === "'" || text[0] === '"') && text.at(-1) === text[0]) {
    return parseQuotedString(text);
  }
  if (text[0] === "[" && text.at(-1) === "]") {
    return splitTopLevel(text.slice(1, -1), ",").map(parseLiteral);
  }
  if (text[0] === "{" && text.at(-1) === "}") {
    const entries = splitTopLevel(text.slice(1, -1), ",").map(entry => {
      const colon = topLevelIndex(entry, ":");
      if (colon === -1) return [entry.trim(), ""];
      const key = parseLiteral(entry.slice(0, colon));
      return [String(key), parseLiteral(entry.slice(colon + 1))];
    });
    return Object.fromEntries(entries);
  }
  if (/^(?:true|True)$/i.test(text)) return true;
  if (/^(?:false|False)$/i.test(text)) return false;
  if (/^(?:null|none)$/i.test(text)) return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return Number(text);
  }
  return text;
}

function parseFunctionCall(source, allowedNames) {
  const match = source.trim().match(/^([a-zA-Z_]\w*)\s*\(([\s\S]*)\)$/);
  if (!match || !allowedNames.has(match[1])) return null;
  const args = {};
  for (const entry of splitTopLevel(match[2], ",")) {
    const equals = topLevelIndex(entry, "=");
    if (equals === -1) return null;
    const name = entry.slice(0, equals).trim();
    if (!/^[a-zA-Z_]\w*$/.test(name)) return null;
    args[name] = parseLiteral(entry.slice(equals + 1));
  }
  return { name: match[1], arguments: args };
}

function parseCallList(source, allowedNames) {
  const parsed = splitTopLevel(source, ",")
    .map(call => parseFunctionCall(call, allowedNames));
  return parsed.length && parsed.every(Boolean) ? parsed : null;
}

function findBalancedListEnd(text, start) {
  if (text[start] !== "[") return -1;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return index;
  }
  return -1;
}

export function parseLfmToolOutput(raw, toolNames = ["web_search"]) {
  const text = String(raw || "");
  const allowedNames = new Set(toolNames);
  const toolCalls = [];
  const ranges = [];
  let truncated = false;
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(CALL_START, cursor);
    if (start === -1) break;
    const bodyStart = start + CALL_START.length;
    const end = text.indexOf(CALL_END, bodyStart);
    if (end === -1) {
      ranges.push([start, text.length]);
      truncated = true;
      break;
    }
    ranges.push([start, end + CALL_END.length]);
    const body = text.slice(bodyStart, end).trim();
    const callList = body[0] === "[" && body.at(-1) === "]"
      ? body.slice(1, -1)
      : body;
    const parsed = parseCallList(callList, allowedNames);
    if (parsed) toolCalls.push(...parsed);
    else truncated = true;
    cursor = end + CALL_END.length;
  }

  if (!ranges.length) {
    const start = text.search(/\S/);
    if (start !== -1 && text[start] === "[") {
      const end = findBalancedListEnd(text, start);
      if (end !== -1) {
        const parsed = parseCallList(text.slice(start + 1, end), allowedNames);
        if (parsed) {
          toolCalls.push(...parsed);
          ranges.push([start, end + 1]);
        }
      } else if ([...allowedNames].some(
        name => text.slice(start).includes(`${name}(`),
      )) {
        ranges.push([start, text.length]);
        truncated = true;
      }
    }
  }

  let content = "";
  cursor = 0;
  for (const [start, end] of ranges) {
    content += text.slice(cursor, start);
    cursor = end;
  }
  content += text.slice(cursor);
  content = content
    .replace(/<\|(?:startoftext|im_start|im_end|pad)\|>/g, "")
    .trim();
  return { content, toolCalls, truncated };
}

export function looksLikeLfmToolCallSyntax(text) {
  const source = String(text || "");
  return source.includes("<|tool_call")
    || source.includes("|tool_call_")
    || /^\s*\[\s*[a-zA-Z_]\w*\s*\(/.test(source);
}

export function stripLfmToolCallSyntax(text) {
  const names = [...String(text || "").matchAll(
    /(?:\[|,)\s*([a-zA-Z_]\w*)\s*\(/g,
  )].map(match => match[1]);
  return parseLfmToolOutput(text, names).content;
}

function formatLiteral(value) {
  if (Array.isArray(value)) return `[${value.map(formatLiteral).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${formatLiteral(entry)}`)
      .join(", ")}}`;
  }
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function renderLfmToolCalls(toolCalls = []) {
  const calls = toolCalls.map(call => {
    const args = typeof call.function?.arguments === "string"
      ? parseLiteral(call.function.arguments)
      : (call.function?.arguments || {});
    const entries = args && typeof args === "object" && !Array.isArray(args)
      ? Object.entries(args)
      : [];
    return `${call.function?.name || ""}(${entries
      .map(([name, value]) => `${name}=${formatLiteral(value)}`)
      .join(", ")})`;
  });
  return calls.length ? `${CALL_START}[${calls.join(", ")}]${CALL_END}` : "";
}
