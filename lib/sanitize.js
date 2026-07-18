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

/** @param {string} text */
export function sanitizeExternalText(text) {
  if (!text) return "";
  let out = String(text);
  for (const re of CONTROL_PATTERNS) {
    out = out.replace(re, "");
  }
  return out.trim();
}
