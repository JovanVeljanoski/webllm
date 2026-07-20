/** @file Pure read and bounded search behavior for uploaded text files. */

import { searchRegexInWorker } from "./regex-search.js";

const lineCache = new WeakMap();

export function resolveAttachment(attachments, pathOrId) {
  const requested = String(pathOrId || "").trim();
  if (!requested) throw new Error("A file path is required.");
  const byId = (attachments || []).find(item => String(item.id) === requested);
  if (byId) return byId;
  const matches = (attachments || []).filter(
    item => String(item.virtualPath || "").toLocaleLowerCase() === requested.toLocaleLowerCase(),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `File path is ambiguous: ${requested}. Use one of: ${matches.map(item => item.virtualPath).join(", ")}`,
    );
  }
  throw new Error(`File not found in this conversation: ${requested}.`);
}

export function attachmentLines(attachment) {
  const content = String(attachment?.content || "");
  if (!attachment || typeof attachment !== "object") return content.split("\n");
  const cached = lineCache.get(attachment);
  if (cached?.content === content) return cached.lines;
  const lines = content.split("\n");
  lineCache.set(attachment, { content, lines });
  return lines;
}

function utf8Prefix(text, maxBytes) {
  if (maxBytes <= 0) return "";
  let output = "";
  let bytes = 0;
  for (const character of String(text || "")) {
    const size = new TextEncoder().encode(character).byteLength;
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

export function readAttachmentRange(attachment, {
  offset = 1,
  limit = 200,
  maxBytes = 8 * 1024,
} = {}) {
  const lines = attachmentLines(attachment);
  const first = Math.max(1, Math.floor(Number(offset) || 1));
  const requestedLimit = Math.max(1, Math.floor(Number(limit) || 1));
  if (first > lines.length) {
    throw new RangeError(
      `Offset ${first} is beyond the end of ${attachment.virtualPath} (${lines.length} lines).`,
    );
  }

  const heading = `${attachment.virtualPath} — requested from line ${first} of ${lines.length}`;
  const output = [];
  let index = first - 1;
  const end = Math.min(lines.length, index + requestedLimit);
  for (; index < end; index++) {
    const row = `${index + 1}: ${lines[index]}`;
    const nextLine = index + 2;
    const footer = nextLine <= lines.length
      ? `[Use read(path=${JSON.stringify(attachment.virtualPath)}, offset=${nextLine}) to continue.]`
      : `[End of file — ${lines.length} lines total.]`;
    const candidate = `${heading}\n${[...output, row].join("\n")}\n\n${footer}`;
    if (new TextEncoder().encode(candidate).byteLength <= maxBytes) {
      output.push(row);
      continue;
    }
    if (!output.length) {
      const prefix = `${index + 1}: `;
      const suffix = "… [line truncated]";
      const fixed = `${heading}\n${prefix}${suffix}\n\n${footer}`;
      const available = Math.max(0, maxBytes - new TextEncoder().encode(fixed).byteLength);
      output.push(`${prefix}${utf8Prefix(lines[index], available)}${suffix}`);
      index++;
    }
    break;
  }

  const lineEnd = first + output.length - 1;
  const truncated = lineEnd < lines.length;
  const nextOffset = truncated ? lineEnd + 1 : null;
  const resultHeading = `${attachment.virtualPath} — lines ${first}-${lineEnd} of ${lines.length}`;
  let content = `${resultHeading}\n${output.join("\n")}`;
  if (nextOffset) {
    content += `\n\n[${output.length} lines shown. Use read(path=${JSON.stringify(
      attachment.virtualPath,
    )}, offset=${nextOffset}) to continue.]`;
  } else {
    content += `\n\n[End of file — ${lines.length} lines total.]`;
  }
  if (new TextEncoder().encode(content).byteLength > maxBytes) {
    const footer = nextOffset
      ? `\n\n[Use read(path=${JSON.stringify(attachment.virtualPath)}, offset=${nextOffset}) to continue.]`
      : `\n\n[End of file — ${lines.length} lines total.]`;
    const available = Math.max(
      0,
      maxBytes - new TextEncoder().encode(`${resultHeading}\n${footer}`).byteLength,
    );
    content = `${resultHeading}\n${utf8Prefix(output.join("\n"), available)}${footer}`;
  }

  return {
    content,
    meta: {
      status: "ok",
      path: attachment.virtualPath,
      offset: first,
      lineStart: first,
      lineEnd,
      totalLines: lines.length,
      truncated,
      nextOffset,
      resultBytes: new TextEncoder().encode(content).byteLength,
    },
  };
}

export function compileIncludeFilter(include) {
  const value = String(include || "").trim();
  if (!value) return () => true;
  if (/[\\/!]/.test(value)) {
    throw new Error("Unsupported include filter. Use forms like *.md, *.json, or *.{js,ts}.");
  }
  const single = value.match(/^\*\.([a-zA-Z0-9]+)$/);
  if (single) {
    const extension = `.${single[1].toLocaleLowerCase()}`;
    return attachment => String(attachment.extension || "").toLocaleLowerCase() === extension;
  }
  const brace = value.match(/^\*\.\{([a-zA-Z0-9]+(?:,[a-zA-Z0-9]+)+)\}$/);
  if (brace) {
    const extensions = new Set(
      brace[1].split(",").map(item => `.${item.toLocaleLowerCase()}`),
    );
    return attachment => extensions.has(String(attachment.extension || "").toLocaleLowerCase());
  }
  throw new Error("Unsupported include filter. Use forms like *.md, *.json, or *.{js,ts}.");
}

function truncateSearchLine(text, maxLength = 500) {
  const source = String(text || "");
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

function formatMatchBlocks(matches, context, linesByAttachment) {
  const grouped = new Map();
  const seenLines = new Map();
  for (const match of matches) {
    if (!grouped.has(match.path)) grouped.set(match.path, []);
    if (!seenLines.has(match.path)) seenLines.set(match.path, new Set());
    const rows = grouped.get(match.path);
    const seen = seenLines.get(match.path);
    if (match.line === 0) {
      rows.push("  [filename match]");
      continue;
    }
    const lines = linesByAttachment.get(match.attachmentId) || [];
    const start = Math.max(1, match.line - context);
    const end = Math.min(lines.length, match.line + context);
    for (let line = start; line <= end; line++) {
      if (seen.has(line)) continue;
      seen.add(line);
      const marker = line === match.line ? ":" : "-";
      rows.push(`  ${line}${marker} ${truncateSearchLine(lines[line - 1])}`);
    }
  }
  return [...grouped].map(([path, rows]) => `${path}:\n${rows.join("\n")}`).join("\n\n");
}

async function searchLiteral(files, {
  pattern,
  ignoreCase,
  limit,
  signal,
  yieldEvery,
}) {
  const needle = ignoreCase ? pattern.toLocaleLowerCase() : pattern;
  const matches = [];
  let visitedLines = 0;
  let hasMore = false;

  const record = match => {
    if (matches.length >= limit) {
      hasMore = true;
      return false;
    }
    matches.push(match);
    return true;
  };

  outer:
  for (const attachment of files) {
    if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
    const comparablePath = ignoreCase
      ? attachment.virtualPath.toLocaleLowerCase()
      : attachment.virtualPath;
    if (comparablePath.includes(needle)) {
      if (!record({
        attachmentId: attachment.id,
        path: attachment.virtualPath,
        line: 0,
      })) {
        break;
      }
    }

    const lines = attachmentLines(attachment);
    for (let index = 0; index < lines.length; index++) {
      const haystack = ignoreCase ? lines[index].toLocaleLowerCase() : lines[index];
      if (haystack.includes(needle) && !record({
        attachmentId: attachment.id,
        path: attachment.virtualPath,
        line: index + 1,
      })) {
        break outer;
      }
      visitedLines++;
      if (visitedLines % yieldEvery === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
      }
    }
  }

  return { matches, hasMore };
}

export async function grepAttachments(attachments, {
  pattern,
  path,
  include,
  ignoreCase = true,
  literal = false,
  context = 0,
  limit = 20,
  maxBytes = 6 * 1024,
  signal,
  yieldEvery = 500,
  regexSearch = searchRegexInWorker,
} = {}) {
  const rawPattern = String(pattern || "");
  if (!rawPattern) throw new Error("Search pattern is required.");
  if (rawPattern.length > 200) throw new Error("Search pattern must be 200 characters or fewer.");
  if (!attachments?.length) {
    return {
      content: "No files are available in this conversation.",
      meta: {
        status: "ok",
        pattern: rawPattern,
        literal,
        filesSearched: 0,
        matchCount: 0,
        resultCount: 0,
      },
    };
  }

  const selected = path
    ? [resolveAttachment(attachments, path)]
    : [...attachments];
  const filter = compileIncludeFilter(include);
  const files = selected.filter(filter);
  const effectiveContext = Math.min(3, Math.max(0, Math.floor(Number(context) || 0)));
  const effectiveLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
  const linesByAttachment = new Map();
  for (const attachment of files) {
    linesByAttachment.set(attachment.id, attachmentLines(attachment));
  }
  const { matches, hasMore } = literal
    ? await searchLiteral(files, {
      pattern: rawPattern,
      ignoreCase,
      limit: effectiveLimit,
      signal,
      yieldEvery,
    })
    : await regexSearch(files, {
      pattern: rawPattern,
      ignoreCase,
      limit: effectiveLimit,
      signal,
    });
  const searchMode = literal ? "literal" : "regex";

  if (!matches.length) {
    return {
      content:
        `No ${searchMode} matches found for ${JSON.stringify(rawPattern)} `
        + `in ${files.length} uploaded files.`,
      meta: {
        status: "ok",
        pattern: rawPattern,
        literal,
        path: path || null,
        include: include || null,
        filesSearched: files.length,
        matchCount: 0,
        resultCount: 0,
        truncated: false,
        resultBytes: 0,
      },
    };
  }

  const blocks = formatMatchBlocks(matches, effectiveContext, linesByAttachment);
  const heading =
    `Found ${matches.length}${hasMore ? "+" : ""} ${searchMode} matches for `
    + `${JSON.stringify(rawPattern)} `
    + `in ${new Set(matches.map(match => match.path)).size} uploaded files.`;
  const encoder = new TextEncoder();
  const rows = blocks.split("\n");
  const output = [];
  let bytes = encoder.encode(`${heading}\n\n`).byteLength;
  let byteTruncated = false;
  const truncationNotice = "\n\n[Results truncated. Refine the pattern, path, or include filter.]";
  const noticeBytes = encoder.encode(truncationNotice).byteLength;
  for (const row of rows) {
    const rowBytes = encoder.encode(`${output.length ? "\n" : ""}${row}`).byteLength;
    if (bytes + rowBytes + noticeBytes > maxBytes) {
      byteTruncated = true;
      break;
    }
    output.push(row);
    bytes += rowBytes;
  }
  const truncated = hasMore || byteTruncated;
  let content = `${heading}\n\n${output.join("\n")}`;
  if (truncated) {
    content += truncationNotice;
  }

  return {
    content,
    meta: {
      status: "ok",
      pattern: rawPattern,
      literal,
      path: path || null,
      include: include || null,
      filesSearched: files.length,
      matchCount: matches.length,
      resultCount: matches.length,
      truncated,
      resultBytes: encoder.encode(content).byteLength,
    },
  };
}
