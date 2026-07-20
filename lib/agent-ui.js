/** @file Convert canonical agent messages into renderable UI steps. */

import { formatQueriesLabel, normalizeWebSearchQueries } from "./web-search-args.js";

export function agentMessagesToSteps(messages, {
  streamingMessage = null,
  activeToolCallIds = new Set(),
  runtimeStatus = null,
} = {}) {
  const steps = [];
  const allMessages = streamingMessage ? [...messages, streamingMessage] : messages;

  for (const [messageIndex, message] of allMessages.entries()) {
    if (message.role === "assistant") {
      const streaming = message === streamingMessage;
      if (message.thinking) {
        steps.push({
          key: `assistant:${messageIndex}:thinking`,
          type: "thinking",
          label: "Thinking",
          thinking: message.thinking,
          streaming,
        });
      }
      for (const [callIndex, call] of (message.tool_calls || []).entries()) {
        steps.push({
          key: `tool-call:${call.id || `${messageIndex}:${callIndex}`}`,
          type: "tool_call",
          toolName: call.function?.name || "tool",
          query: toolCallLabel(call),
          searching: activeToolCallIds.has(call.id),
          streaming: activeToolCallIds.has(call.id),
        });
      }
      if (message.content) {
        steps.push({
          key: `assistant:${messageIndex}:answer`,
          type: "answer",
          content: message.content,
          meta: message.meta,
          streaming,
        });
      }
    } else if (message.role === "tool") {
      steps.push({
        key: `tool-result:${message.tool_call_id || messageIndex}`,
        type: "tool_result",
        toolName: message.name || "tool",
        query: message.meta?.query || "",
        content: message.content || "",
        resultCount: message.meta?.resultCount ?? 0,
        status: message.meta?.status || "ok",
        streaming: false,
      });
    }
  }
  if (
    runtimeStatus?.active
    && !streamingMessage?.thinking
    && !streamingMessage?.content
  ) {
    const messageIndex = streamingMessage ? allMessages.length - 1 : allMessages.length;
    steps.push({
      key: `assistant:${messageIndex}:runtime`,
      type: "runtime_status",
      label: runtimeStatus.label || "Working",
      streaming: true,
    });
  }
  return steps;
}

function toolCallLabel(call) {
  const args = parseArguments(call.function?.arguments);
  if (call.function?.name === "web_search") {
    return formatQueriesLabel(normalizeWebSearchQueries(args));
  }
  if (call.function?.name === "read") {
    const path = String(args?.path || "uploaded file");
    const offset = Number(args?.offset) || 1;
    return offset > 1 ? `${path} from line ${offset}` : path;
  }
  if (call.function?.name === "grep") {
    const pattern = String(args?.pattern || "");
    const path = args?.path ? ` in ${args.path}` : "";
    return `${pattern}${path}`.trim();
  }
  try {
    return JSON.stringify(args);
  } catch {
    return String(args || "");
  }
}

function parseArguments(value) {
  if (typeof value !== "string") return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
