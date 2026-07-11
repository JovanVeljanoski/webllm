/** @file Assistant-visible content guards for agent turns. */

import { looksLikeToolCallSyntax, stripToolCallSyntax } from "./tool-parser.js";

/** @param {string} text */
export function looksLikeRawSearchDump(text) {
  const t = (text || "").trim();
  return /^\[1\]\s/m.test(t) && /\bURL:\shttps?:\/\//i.test(t);
}

/** @param {string} text */
export function looksLikeClarificationOnly(text) {
  const t = (text || "").toLowerCase();
  if (!t) return false;
  return (
    /what (sport|league|match|tournament)/.test(t)
    || /tell me what (sport|league)/.test(t)
    || /which (sport|league|match|tournament)/.test(t)
    || /need (a little )?more context/.test(t)
    || /please (?:tell|specify|clarify)/.test(t) && /\?/.test(t)
  );
}

/** @param {string} content */
export function safeAssistantContent(content) {
  const cleaned = stripToolCallSyntax(content || "").trim();
  if (!cleaned) return "";
  if (looksLikeToolCallSyntax(cleaned)) return "";
  if (looksLikeRawSearchDump(cleaned)) return "";
  return cleaned;
}
