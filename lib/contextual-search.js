/** @file Context-aware freshness query routing for forced / host-resolved web search. */

const FRESHNESS_STRONG_RE =
  /\b(right now|live|currently|today|tonight|this week|latest|recent|now|score|scores|result|results|weather forecast)\b/i;
const FRESHNESS_WEAK_RE =
  /\b(yesterday|this month|current|202[4-9]|match|game|standings?)\b/i;
const FOLLOW_UP_RE =
  /\b(what about|how about|and what|and how|that match|today'?s one|the latest one)\b/i;
const EXPLICIT_REFERENT_RE =
  /\b(fifa|world cup|nba|nfl|wimbledon|utrecht|weather in [a-z]+|temperature in [a-z]+)\b/i;

/** @typedef {{ label: string, keywords: RegExp, queryPrefix: string }} TopicHint */

/** @type {TopicHint[]} */
const TOPIC_HINTS = [
  { label: "FIFA World Cup", keywords: /\b(fifa|world cup)\b/i, queryPrefix: "FIFA World Cup" },
  { label: "NBA", keywords: /\bnba\b/i, queryPrefix: "NBA" },
  { label: "NFL", keywords: /\bnfl\b/i, queryPrefix: "NFL" },
  { label: "Wimbledon", keywords: /\bwimbledon\b/i, queryPrefix: "Wimbledon tennis" },
  { label: "Utrecht weather", keywords: /\butrecht\b.*\bweather\b|\bweather\b.*\butrecht\b/i, queryPrefix: "Utrecht weather" },
];

/**
 * @param {string} userText
 */
function scoreFreshnessIntent(userText) {
  const text = (userText || "").trim();
  if (!text) return 0;
  if (/\b(right now|live|currently)\b/i.test(text)) return 0.95;
  if (FRESHNESS_STRONG_RE.test(text)) return 0.92;
  if (FRESHNESS_WEAK_RE.test(text)) return 0.7;
  return 0;
}

/**
 * @param {object[]} messages
 * @returns {{ hint: TopicHint, score: number }[]}
 */
function scoreTopicCandidates(messages) {
  const recent = messages.slice(-8);
  /** @type {Map<string, { hint: TopicHint, score: number, lastIdx: number }>} */
  const scores = new Map();

  for (let i = 0; i < recent.length; i++) {
    const text = typeof recent[i]?.content === "string" ? recent[i].content : "";
    if (!text) continue;
    for (const hint of TOPIC_HINTS) {
      if (!hint.keywords.test(text)) continue;
      const prev = scores.get(hint.label) || { hint, score: 0, lastIdx: -1 };
      prev.score += recent[i].role === "user" ? 0.42 : 0.36;
      prev.lastIdx = i;
      scores.set(hint.label, prev);
    }
  }

  const ranked = [...scores.values()].map(({ hint, score, lastIdx }) => ({
    hint,
    score: Math.min(score + (lastIdx >= recent.length - 3 ? 0.18 : 0), 0.95),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * @param {string} userText
 * @param {TopicHint} topic
 */
function buildEnrichedQuery(userText, topic) {
  const base = userText.trim();
  if (new RegExp(topic.queryPrefix.replace(/\s+/g, "\\s+"), "i").test(base)) {
    return base;
  }
  return `${topic.queryPrefix} ${base}`.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} userText
 * @param {object[]} messages
 * @returns {{
 *   query: string,
 *   topic: string|null,
 *   freshnessIntentConfidence: number,
 *   referentResolutionConfidence: number,
 *   ambiguous?: boolean,
 *   canBypassGenerationOne: boolean,
 *   confidence: number,
 * }}
 */
export function resolveContextualFreshnessQuery(userText, messages) {
  const text = (userText || "").trim();
  const freshnessIntentConfidence = scoreFreshnessIntent(text);
  const isFollowUp = FOLLOW_UP_RE.test(text);
  const candidates = scoreTopicCandidates(messages);

  if (EXPLICIT_REFERENT_RE.test(text)) {
    const hint = TOPIC_HINTS.find(h => h.keywords.test(text));
    const query = hint ? buildEnrichedQuery(text, hint) : text;
    const freshnessIntentConfidence = Math.max(
      scoreFreshnessIntent(text),
      /\bweather\b/i.test(text) ? 0.92 : 0,
    );
    const referentResolutionConfidence = 0.95;
    return {
      query,
      topic: hint?.label ?? null,
      freshnessIntentConfidence,
      referentResolutionConfidence,
      canBypassGenerationOne:
        freshnessIntentConfidence >= 0.9 && referentResolutionConfidence >= 0.9,
      confidence: 0.95,
    };
  }

  if (candidates.length > 1) {
    const margin = candidates[0].score - candidates[1].score;
    const referentResolutionConfidence = margin >= 0.15 ? candidates[0].score : 0.35;
    return {
      query: text,
      topic: null,
      freshnessIntentConfidence,
      referentResolutionConfidence,
      ambiguous: true,
      canBypassGenerationOne: false,
      confidence: Math.min(freshnessIntentConfidence, referentResolutionConfidence),
    };
  }

  if (isFollowUp && candidates.length === 0 && freshnessIntentConfidence >= 0.7) {
    return {
      query: text,
      topic: null,
      freshnessIntentConfidence,
      referentResolutionConfidence: 0.2,
      ambiguous: true,
      canBypassGenerationOne: false,
      confidence: 0.2,
    };
  }

  if (candidates.length === 1) {
    const query = buildEnrichedQuery(text, candidates[0].hint);
    const referentResolutionConfidence = isFollowUp
      ? Math.max(candidates[0].score, 0.91)
      : candidates[0].score;
    const canBypassGenerationOne =
      freshnessIntentConfidence >= 0.9 &&
      referentResolutionConfidence >= 0.9;
    return {
      query,
      topic: candidates[0].hint.label,
      freshnessIntentConfidence,
      referentResolutionConfidence,
      canBypassGenerationOne,
      confidence: Math.min(freshnessIntentConfidence, referentResolutionConfidence),
    };
  }

  if (!isFollowUp && freshnessIntentConfidence >= 0.7) {
    return {
      query: text,
      topic: null,
      freshnessIntentConfidence,
      referentResolutionConfidence: 0.2,
      ambiguous: true,
      canBypassGenerationOne: false,
      confidence: 0.2,
    };
  }

  return {
    query: text,
    topic: null,
    freshnessIntentConfidence,
    referentResolutionConfidence: 0.35,
    canBypassGenerationOne: false,
    confidence: 0.35,
  };
}

/**
 * @param {string} userText
 * @param {object[]} messages
 */
export function shouldBypassGenerationOne(userText, messages) {
  const routed = resolveContextualFreshnessQuery(userText, messages);
  return routed.canBypassGenerationOne;
}
