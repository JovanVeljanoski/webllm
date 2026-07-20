/** @file Fuzzy @file completion and stable message-reference helpers. */

function fuzzyScore(candidate, query) {
  const value = String(candidate || "").toLocaleLowerCase();
  const needle = String(query || "").toLocaleLowerCase().trim();
  if (!needle) return 0;
  if (value === needle) return -1000;
  if (value.startsWith(needle)) return -500 + value.length;
  const direct = value.indexOf(needle);
  if (direct >= 0) return -250 + direct;

  let position = -1;
  let gap = 0;
  for (const char of needle) {
    const next = value.indexOf(char, position + 1);
    if (next < 0) return null;
    gap += next - position - 1;
    position = next;
  }
  return gap + value.length;
}

export function fuzzyMatchAttachments(attachments, query, limit = 8) {
  return (attachments || [])
    .map((attachment, index) => ({
      attachment,
      index,
      score: fuzzyScore(attachment.virtualPath, query),
    }))
    .filter(item => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, Math.max(1, limit))
    .map(item => item.attachment);
}

export function findAtFileQuery(value, caret = String(value || "").length) {
  const text = String(value || "");
  const cursor = Math.max(0, Math.min(text.length, Number(caret) || 0));
  const start = text.lastIndexOf("@", cursor - 1);
  if (start < 0) return null;
  const preceding = text[start - 1] || "";
  if (preceding && !/[\s([{"'`]/.test(preceding)) return null;
  const query = text.slice(start + 1, cursor);
  if (query.includes("\n") || query.length > 100) return null;
  return { start, end: cursor, query };
}

export function replaceAtFileQuery(value, range, virtualPath) {
  const text = String(value || "");
  const inserted = `@${virtualPath}`;
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  const needsSpace = after && !/^\s|^[,.;:!?)}\]]/.test(after);
  const nextValue = `${before}${inserted}${needsSpace ? " " : ""}${after}`;
  return {
    value: nextValue,
    caret: before.length + inserted.length + (needsSpace ? 1 : 0),
  };
}

function hasMentionStartBoundary(text, index) {
  if (index === 0) return true;
  return /[\s([{"'`]/.test(text[index - 1]);
}

function hasMentionEndBoundary(text, index) {
  if (index >= text.length) return true;
  const next = text[index];
  if (/[\s,;:!?)}\]"']/.test(next)) return true;
  if (next !== ".") return false;
  const afterPeriod = text[index + 1] || "";
  return !afterPeriod || /[\s,;:!?)}\]"']/.test(afterPeriod);
}

export function findFileMentions(text, attachments = []) {
  const source = String(text || "");
  const candidates = (attachments || [])
    .filter(attachment => attachment?.id && attachment?.virtualPath)
    .map((attachment, order) => ({
      attachment,
      order,
      reference: `@${attachment.virtualPath}`,
    }))
    .sort((a, b) => b.reference.length - a.reference.length || a.order - b.order);
  const mentions = [];

  for (let index = 0; index < source.length; index++) {
    if (source[index] !== "@" || !hasMentionStartBoundary(source, index)) continue;
    const match = candidates.find(candidate => {
      const end = index + candidate.reference.length;
      return source.slice(index, end).toLocaleLowerCase()
        === candidate.reference.toLocaleLowerCase()
        && hasMentionEndBoundary(source, end);
    });
    if (!match) continue;
    const end = index + match.reference.length;
    mentions.push({
      id: String(match.attachment.id),
      virtualPath: String(match.attachment.virtualPath),
      start: index,
      end,
    });
    index = end - 1;
  }
  return mentions;
}

export function exactFileRefsInText(text, attachments) {
  return [...new Set(findFileMentions(text, attachments).map(mention => mention.id))];
}

export function mergeFileRefs(...groups) {
  return [...new Set(
    groups.flatMap(group => Array.from(group || [])).map(String).filter(Boolean),
  )];
}

export function reconcileSelectedFileRefs(selectedRefs, text, attachments = []) {
  const available = new Set((attachments || []).map(attachment => String(attachment.id)));
  const mentioned = new Set(exactFileRefsInText(text, attachments));
  return mergeFileRefs(selectedRefs)
    .filter(id => available.has(String(id)) && mentioned.has(String(id)));
}

export function resolveDraftFileRefs({
  pendingRefs = [],
  text = "",
  attachments = [],
} = {}) {
  return reconcileSelectedFileRefs(pendingRefs, text, attachments);
}
