/** @file Neutralize runtime control tokens in untrusted external text. */

const CONTROL_PATTERNS = [
  /<\|tool_call_start\|>/g,
  /<\|tool_call_end\|>/g,
  /<\|tool_response_start\|>/g,
  /<\|tool_response_end\|>/g,
  /<\|tool_call>/g,
  /<\|tool_call\|>/g,
  /<tool_call\|>/g,
  /<\|tool_response>/g,
  /<\|tool_response\|>/g,
  /<\|tool>/g,
  /<\|tool\|>/g,
  /<\|channel>/g,
  /<\|channel\|>/g,
  /<channel\|>/g,
  /<\|think\|>/g,
  /<\|turn>/g,
  /<\|turn\|>/g,
  /<\|startoftext\|>/g,
  /<\|endoftext\|>/g,
  /<\|im_start\|>/g,
  /<\|im_end\|>/g,
  /<think>/g,
  /<\/redacted_thinking>/g,
  /<\|pad\|>/g,
  /<\|"\|>/g,
];

const TOOL_XML_PATTERNS = [
  /<\/?think>/gi,
  /<\/?redacted_thinking>/gi,
  /<\/?tool_call(?:\s[^>]*)?>/gi,
  /<\/?tool_response(?:\s[^>]*)?>/gi,
  /<function=[^>]*>/gi,
  /<\/function>/gi,
  /<parameter=[^>]*>/gi,
  /<\/parameter>/gi,
];

/** @param {string} text */
export function sanitizeExternalText(text) {
  if (!text) return "";
  let out = String(text);
  for (const re of CONTROL_PATTERNS) {
    out = out.replace(re, "");
  }
  return out.trim();
}

/** Stronger boundary for data that must never contain model-native XML tool tags. */
export function sanitizeUntrustedToolText(text, { preserveWhitespace = false } = {}) {
  if (!text) return "";
  let out = String(text);
  for (const re of CONTROL_PATTERNS) {
    out = out.replace(re, "");
  }
  for (const re of TOOL_XML_PATTERNS) {
    out = out.replace(re, "");
  }
  return preserveWhitespace ? out : out.trim();
}
