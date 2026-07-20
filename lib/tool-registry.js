/** @file Build the active tool set from conversation capabilities and preferences. */

import { createLocalFileTools } from "./file-tools.js";
import { createWebSearchTool } from "./web-search-tool.js";

export const TOOL_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: "read",
    scope: "local_file",
    requiresAttachments: true,
    conflictsWithGrammar: true,
  }),
  Object.freeze({
    id: "grep",
    scope: "local_file",
    requiresAttachments: true,
    conflictsWithGrammar: true,
  }),
  Object.freeze({
    id: "web_search",
    scope: "network",
    requiresAttachments: false,
    conflictsWithGrammar: true,
  }),
]);

export function resolveToolAvailability({
  attachments = [],
  preferences = {},
  modelSupportsTools = true,
  grammarMode = "off",
  runtimeReady = true,
} = {}) {
  return TOOL_DESCRIPTORS.map(descriptor => {
    const preferred = preferences[descriptor.id] === true;
    let reason = "";
    if (!modelSupportsTools) reason = "model_unsupported";
    else if (descriptor.requiresAttachments && !attachments.length) reason = "no_attachments";
    else if (descriptor.conflictsWithGrammar && grammarMode !== "off") {
      reason = "grammar_active";
    } else if (!runtimeReady) reason = "runtime_unavailable";
    const available = !["model_unsupported", "no_attachments", "grammar_active"].includes(reason);
    return {
      ...descriptor,
      preferred,
      available,
      active: preferred && available && runtimeReady,
      reason: reason || (preferred ? "" : "disabled"),
    };
  });
}

export function localFileReferencesAvailable(availability = []) {
  return availability.some(tool => (
    tool.scope === "local_file" && tool.preferred && tool.available
  ));
}

export function createActiveTools({
  attachments = [],
  modelId,
  readEnabled = false,
  grepEnabled = false,
  webSearchEnabled = false,
  searchProvider,
  availability,
} = {}) {
  const resolved = availability || resolveToolAvailability({
    attachments,
    preferences: {
      read: readEnabled,
      grep: grepEnabled,
      web_search: webSearchEnabled,
    },
  });
  const activeIds = new Set(
    resolved.filter(tool => tool.active).map(tool => tool.id),
  );
  const tools = createLocalFileTools(attachments, modelId, {
    readEnabled: activeIds.has("read"),
    grepEnabled: activeIds.has("grep"),
  });
  if (activeIds.has("web_search")) {
    if (typeof searchProvider?.search !== "function") {
      throw new TypeError("An active web_search tool requires a search provider.");
    }
    tools.push(createWebSearchTool(searchProvider));
  }
  return tools;
}

export function activeToolNames(tools = []) {
  return tools.map(tool => tool.name).filter(Boolean);
}
