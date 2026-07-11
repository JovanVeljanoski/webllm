/** @file Detect when to run web search without a native model tool call. */

const SEARCH_VERB_RE =
  /\b(search|look up|lookup|find (?:out|info|information)|google|browse the web|check online|use (?:the )?web_search)\b/i;
const FRESHNESS_RE =
  /\b(today|tonight|yesterday|this week|this month|current|latest|recent|now|202[4-9]|news|weather|stock price|score|trades?|standings?)\b/i;

/**
 * @param {string} message
 */
export function looksLikeMultiTopicSearch(message) {
  const text = (message || "").trim();
  if (!text) return false;
  if (/\?\s*(and|also)\b/i.test(text)) return true;
  if (/,?\s+and\s+(?:what|how|when|where|who|why|is|are|tell|give|show)\b/i.test(text)) return true;
  if (/\b(and also|as well as)\b/i.test(text)) return true;

  const topicSignals = [
    /\bnews\b/i,
    /\bweather\b/i,
    /\bforecast\b/i,
    /\bstock\b/i,
    /\bprice\b/i,
    /\bscore\b/i,
    /\bstandings?\b/i,
    /\btrades?\b/i,
  ];
  const matchedTopics = topicSignals.filter((re) => re.test(text)).length;
  if (matchedTopics >= 2 && /\band\b/i.test(text)) return true;

  return false;
}

/**
 * @param {string} message
 */
export function userWantsWebSearch(message) {
  const text = (message || "").trim();
  if (!text) return false;
  if (SEARCH_VERB_RE.test(text)) return true;
  if (FRESHNESS_RE.test(text)) return true;
  if (/\bweb_search\b/i.test(text)) return true;
  return false;
}

/**
 * @param {string} message
 * @param {{ recentMessages?: object[] }} [options]
 */
export function inferSearchQuery(message, options = {}) {
  let q = (message || "").trim();
  q = q.replace(/^(please\s+)?(can you\s+)?(use (?:the )?web_search tool to\s+)?/i, "");
  q = q.replace(/^(search (?:the web|online) for\s+)/i, "");
  q = q.replace(/^(look up\s+)/i, "");
  q = q.trim() || message.trim();

  const recent = options.recentMessages || [];
  const contextHints = [];
  for (const m of recent.slice(-6)) {
    const text = typeof m?.content === "string" ? m.content : "";
    if (!text) continue;
    if (/\bfifa\b/i.test(text)) contextHints.push("FIFA World Cup");
    if (/\bworld cup\b/i.test(text)) contextHints.push("FIFA World Cup");
    if (/\bnba\b/i.test(text)) contextHints.push("NBA");
    if (/\bnfl\b/i.test(text)) contextHints.push("NFL");
    if (/\bwimbledon\b/i.test(text)) contextHints.push("Wimbledon");
  }
  const hint = [...new Set(contextHints)][0];
  if (hint && !new RegExp(hint.replace(/\s+/g, "\\s+"), "i").test(q)) {
    q = `${hint} ${q}`;
  }
  return q.trim();
}

/**
 * @param {object[]} messages
 * @returns {string|null}
 */
export function lastUserMessageText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && typeof messages[i].content === "string") {
      return messages[i].content;
    }
  }
  return null;
}
