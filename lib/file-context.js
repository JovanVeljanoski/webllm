/** @file Build metadata manifests and bounded model-only file excerpts. */

import { formatBytes } from "./attachments.js";
import { modelLocalFileConfig } from "./models.js";
import { sanitizeUntrustedToolText } from "./sanitize.js";

const CATEGORY_LABELS = Object.freeze({
  plain_text: "Text",
  structured_text: "Structured text",
  web_source: "Web source",
});

const encoder = new TextEncoder();

export function referencedFileExcerptBudget(modelId) {
  return modelLocalFileConfig(modelId).excerptBytes;
}

export function buildFileManifest(
  attachments = [],
  { readEnabled = true, grepEnabled = true } = {},
) {
  if (!attachments.length) return "No files are currently uploaded to this conversation.";
  let toolHint = "";
  if (readEnabled && grepEnabled) {
    toolHint = "Use grep to search these files and read to inspect relevant line ranges.";
  } else if (readEnabled) {
    toolHint = "Use read to inspect relevant line ranges in these files.";
  } else if (grepEnabled) {
    toolHint = "Use grep to search these files.";
  }
  return [
    "Files available in this conversation:",
    ...attachments.map(attachment => (
      `- ${attachment.virtualPath} — ${CATEGORY_LABELS[attachment.category] || "Text"}, `
      + `${attachment.lineCount || 1} lines, ${formatBytes(attachment.storedBytes)}`
    )),
    "",
    toolHint,
  ].join("\n");
}

function fitPrefixLines(attachment, maxBytes) {
  const lines = sanitizeUntrustedToolText(
    String(attachment.content || ""),
    { preserveWhitespace: true },
  ).split("\n");
  const header = `[Referenced file: ${attachment.virtualPath}]\n`;
  const end = `\n[Use read(path=${JSON.stringify(attachment.virtualPath)}, offset=NEXT) for more.]`;
  const fullEnd = `\n[End of referenced file — ${lines.length} lines.]`;
  const rows = [];
  let bytes = encoder.encode(header).byteLength;

  for (let index = 0; index < lines.length; index++) {
    const row = `${index + 1}: ${lines[index]}`;
    const continuation = end.replace("NEXT", String(index + 2));
    const required = encoder.encode(
      `${rows.length ? "\n" : ""}${row}${index === lines.length - 1 ? fullEnd : continuation}`,
    ).byteLength;
    if (bytes + required > maxBytes) break;
    rows.push(row);
    bytes += encoder.encode(`${rows.length > 1 ? "\n" : ""}${row}`).byteLength;
  }

  if (!rows.length) {
    const compact = `[Referenced file: ${attachment.virtualPath}]\n`
      + `[No excerpt fits this model's file-context budget. Use read to inspect it.]`;
    return encoder.encode(compact).byteLength <= maxBytes ? compact : "";
  }
  const complete = rows.length === lines.length;
  return `${header}${rows.join("\n")}${complete
    ? fullEnd
    : end.replace("NEXT", String(rows.length + 1))}`;
}

export function buildReferencedFileContext(fileRefs, attachments, modelId) {
  const uniqueIds = [...new Set(
    (Array.isArray(fileRefs) ? fileRefs : []).map(String).filter(Boolean),
  )];
  const selected = uniqueIds
    .map(id => attachments.find(attachment => String(attachment.id) === id))
    .filter(Boolean);
  if (!selected.length) return "";

  const totalBudget = referencedFileExcerptBudget(modelId);
  const separatorBytes = Math.max(0, selected.length - 1) * 2;
  const perFileBudget = Math.floor((totalBudget - separatorBytes) / selected.length);
  const blocks = selected
    .map(attachment => fitPrefixLines(attachment, perFileBudget))
    .filter(Boolean);
  return blocks.join("\n\n");
}

export function expandFileReferences(messages, attachments = [], modelId) {
  if (!attachments.length) return messages;
  let changed = false;
  const output = messages.map(message => {
    if (message.role !== "user" || !message.fileRefs?.length) return message;
    const context = buildReferencedFileContext(message.fileRefs, attachments, modelId);
    if (!context) return message;
    changed = true;
    return {
      ...message,
      content: `${String(message.content || "")}\n\n${context}`,
    };
  });
  return changed ? output : messages;
}
