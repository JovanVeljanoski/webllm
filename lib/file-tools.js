/** @file Factories for bounded local read and safe regex/literal grep tools. */

import { grepAttachments, readAttachmentRange, resolveAttachment } from "./file-search.js";
import { buildFileManifest } from "./file-context.js";
import { modelLocalFileConfig } from "./models.js";
import { sanitizeUntrustedToolText } from "./sanitize.js";
import {
  GREP_TOOL_SPEC,
  LOCAL_FILE_USE_POLICY,
  READ_TOOL_SPEC,
} from "./tools.js";

export function localFileToolBudget(modelId) {
  return modelLocalFileConfig(modelId);
}

function boundedInteger(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveReadAttachment(attachments, args) {
  const requestedPath =
    args.path || args.file_path || args.file || args.filename || "";
  if (requestedPath) {
    try {
      return {
        attachment: resolveAttachment(attachments, requestedPath),
        inferred: false,
      };
    } catch (error) {
      if (attachments.length !== 1) throw error;
    }
  }
  if (attachments.length === 1) {
    return { attachment: attachments[0], inferred: true };
  }
  if (attachments.length > 1) {
    throw new Error(
      `A file path is required because this conversation has multiple files. Available paths: ${
        attachments.map(attachment => attachment.virtualPath).join(", ")
      }.`,
    );
  }
  throw new Error("A file path is required.");
}

export function createReadTool(attachments, modelId) {
  const budget = localFileToolBudget(modelId);
  const completedReads = new Set();
  return {
    ...READ_TOOL_SPEC,
    async execute(args = {}) {
      const { attachment, inferred } = resolveReadAttachment(attachments, args);
      const offset = boundedInteger(args.offset, 1, 1, Number.MAX_SAFE_INTEGER);
      const limit = boundedInteger(args.limit, budget.readLines, 1, 400);
      const key = `${attachment.id}:${offset}:${limit}`;
      if (completedReads.has(key)) {
        return {
          content: `Skipped duplicate read of ${attachment.virtualPath} at offset ${offset}; use the existing result above.`,
          meta: {
            status: "skipped",
            path: attachment.virtualPath,
            offset,
            resultCount: 0,
          },
        };
      }
      completedReads.add(key);
      const result = readAttachmentRange(attachment, {
        offset,
        limit,
        maxBytes: budget.readBytes,
      });
      return {
        content: sanitizeUntrustedToolText(result.content),
        meta: {
          ...result.meta,
          pathInferred: inferred,
          resultCount: result.meta.lineEnd - result.meta.lineStart + 1,
        },
      };
    },
  };
}

export function createGrepTool(attachments, modelId) {
  const budget = localFileToolBudget(modelId);
  const completedSearches = new Set();
  return {
    ...GREP_TOOL_SPEC,
    async execute(args = {}, { signal } = {}) {
      const pattern = String(args.pattern || "");
      const ignoreCase = args.ignore_case !== false;
      const literal = args.literal === true;
      const context = boundedInteger(args.context, 0, 0, 3);
      const limit = boundedInteger(args.limit, budget.grepMatches, 1, 50);
      const key = JSON.stringify([
        pattern,
        args.path || "",
        args.include || "",
        ignoreCase,
        literal,
        context,
        limit,
      ]);
      if (completedSearches.has(key)) {
        return {
          content: "Skipped duplicate grep search; use the existing result above.",
          meta: {
            status: "skipped",
            pattern,
            literal,
            query: pattern,
            resultCount: 0,
          },
        };
      }
      completedSearches.add(key);
      const result = await grepAttachments(attachments, {
        pattern,
        path: args.path,
        include: args.include,
        ignoreCase,
        literal,
        context,
        limit,
        maxBytes: budget.grepBytes,
        signal,
      });
      return {
        content: sanitizeUntrustedToolText(result.content),
        meta: {
          ...result.meta,
          query: pattern,
        },
      };
    },
  };
}

function activeLocalFilePolicy({ readEnabled, grepEnabled }) {
  if (readEnabled && grepEnabled) return LOCAL_FILE_USE_POLICY;
  if (readEnabled) {
    return "Use read only for files listed in the uploaded-file manifest. " +
      "When the user references @file, focus on that file and inspect only relevant line ranges. " +
      "Do not repeatedly request the same range or claim to have read unavailable content.";
  }
  return "Use grep only for files listed in the uploaded-file manifest. " +
    "When the user references @file, focus on that file. " +
    "Use regex searches when useful, set literal=true for exact text, and identify evidence " +
    "with virtual paths and line numbers.";
}

export function createLocalFileTools(
  attachments,
  modelId,
  { readEnabled = true, grepEnabled = true } = {},
) {
  if (!attachments?.length) return [];
  const tools = [];
  if (readEnabled) tools.push(createReadTool(attachments, modelId));
  if (grepEnabled) tools.push(createGrepTool(attachments, modelId));
  if (!tools.length) return [];
  const policy = activeLocalFilePolicy({ readEnabled, grepEnabled });
  const manifest = buildFileManifest(attachments, { readEnabled, grepEnabled });
  return tools.map(tool => ({
    ...tool,
    promptPolicy: [
      ...(tool.promptPolicy || []),
      policy,
      manifest,
    ],
  }));
}
