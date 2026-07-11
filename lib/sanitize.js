/** @file Neutralize Gemma control tokens in untrusted external text. */

const CONTROL_PATTERNS = [
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
  /<\|"\|>/g,
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
