/** @file Lightweight lexical grounding checks for synthesis answers. */

const STOPWORDS = new Set([
  "about", "after", "also", "and", "are", "for", "from", "game", "have", "latest",
  "match", "more", "result", "results", "that", "the", "this", "today", "what",
  "when", "where", "which", "with", "your", "weather",
]);

/** @param {string} text */
function normalize(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * @param {string} haystack
 * @param {string} anchor
 */
function containsAnchor(haystack, anchor) {
  const a = normalize(anchor);
  if (!a || a.length < 2) return false;
  return normalize(haystack).includes(a);
}

/**
 * @param {string} evidence
 * @param {string} query
 */
export function extractEvidenceAnchors(evidence, query) {
  const q = normalize(query);
  /** @type {string[]} */
  const strongAnchors = [];
  /** @type {string[][]} */
  const mediumAnchorsByResult = [];

  const body = (evidence || "").replace(/^WEB_SEARCH_EVIDENCE[\s\S]*?\n\n/i, "").replace(/\nEND_WEB_SEARCH_EVIDENCE[\s\S]*$/i, "");
  const blocks = body.split(/\nRESULT \d+\n/i).map(b => b.trim()).filter(Boolean);
  if (!blocks.length && body.trim()) blocks.push(body.trim());

  for (const block of blocks) {
    /** @type {string[]} */
    const medium = [];
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || "";
    const text = block.match(/^Text:\s*(.+)$/m)?.[1]?.trim() || block;
    const published = block.match(/^Published:\s*(.+)$/m)?.[1]?.trim() || "";
    const factual = [title, text, published].filter(Boolean).join(" ");

    for (const m of factual.matchAll(/\b\d+\s*[-–]\s*\d+\b/g)) {
      strongAnchors.push(m[0]);
    }
    for (const m of factual.matchAll(/\b\d+(?:\.\d+)?\s*(?:°c|km\/h|mph|%)\b/gi)) {
      strongAnchors.push(m[0]);
    }
    for (const m of factual.matchAll(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/gi)) {
      strongAnchors.push(m[0]);
    }
    for (const m of factual.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
      strongAnchors.push(m[0]);
    }

    for (const phrase of title.split(/[;,|]/)) {
      const p = phrase.trim();
      if (p.length >= 4 && !q.includes(normalize(p))) strongAnchors.push(p);
    }

    for (const token of factual.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || []) {
      if (token.length >= 4 && !q.includes(normalize(token))) medium.push(token);
    }
    for (const token of factual.toLowerCase().match(/\b[a-z]{5,}\b/g) || []) {
      if (STOPWORDS.has(token) || q.includes(token)) continue;
      medium.push(token);
    }

    mediumAnchorsByResult.push([...new Set(medium)]);
  }

  return {
    strongAnchors: [...new Set(strongAnchors)],
    mediumAnchorsByResult,
  };
}

/**
 * @param {string} answer
 * @param {string} evidence
 * @param {string} query
 */
export function appearsGrounded(answer, evidence, query) {
  const a = answer || "";
  if (!evidence?.trim()) return true;

  const { strongAnchors, mediumAnchorsByResult } = extractEvidenceAnchors(evidence, query);
  if (!strongAnchors.length && mediumAnchorsByResult.every(a => !a.length)) {
    return true;
  }

  if (strongAnchors.some(anchor => containsAnchor(a, anchor))) return true;

  return mediumAnchorsByResult.some(anchors => {
    const matched = anchors.filter(anchor => containsAnchor(a, anchor));
    return matched.length >= 2;
  });
}
