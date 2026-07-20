/** @file Bonsai runtime adapter for normalized assistant messages. */

import { generateToCompletion } from "./bonsai-generate.js";
import {
  parseBonsaiToolOutput,
  renderBonsaiToolCalls,
  stripBonsaiToolCallSyntax,
} from "./bonsai-tool-parser.js";
import { sanitizeExternalText } from "./sanitize.js";
import { GenerationTracker } from "./generation-tracker.js";
import { effectiveMaxNewTokens, fitMessagesToContext } from "./context-window.js";

export const BONSAI_TOOL_PROTOCOL =
  "When calling a tool, reply ONLY with this XML format:\n" +
  "<tool_call>\n<function=TOOL_NAME>\n<parameter=ARG_NAME>\nvalue\n</parameter>\n</tool_call>\n" +
  "Never invent tool results.";

function withChatTemplateArgs(model, enableThinking, fn) {
  const previous = model.chatTemplateArgs;
  model.chatTemplateArgs = {
    ...previous,
    enable_thinking: enableThinking,
    preserve_thinking: true,
  };
  try {
    return fn();
  } finally {
    model.chatTemplateArgs = previous;
  }
}

export function applyBonsaiChatTemplate(model, { enableThinking = false } = {}) {
  model.chatTemplateArgs = {
    ...model.chatTemplateArgs,
    enable_thinking: enableThinking,
    preserve_thinking: true,
  };
}

export function countBonsaiPromptTokens(
  model,
  messages,
  { tools = [], enableThinking = false } = {},
) {
  if (typeof model?.encodePrompt !== "function") return null;
  const previousTools = model._agentTools;
  return withChatTemplateArgs(model, enableThinking, () => {
    model._agentTools = tools.length ? tools : null;
    try {
      return model.encodePrompt(messages).length;
    } finally {
      model._agentTools = previousTools;
    }
  });
}

export async function generateBonsaiAssistant({
  model,
  messages,
  tools = [],
  knownTools = tools,
  maxNewTokens,
  contextWindowTokens,
  signal,
  onStream,
  onRequestPrepared,
  tracker,
  enableThinking = false,
}) {
  const activeTracker = tracker || new GenerationTracker();
  const schemas = tools.map(tool => tool.schema);
  const boundedMaxNewTokens = effectiveMaxNewTokens(maxNewTokens, { contextWindowTokens });
  const bonsaiMessages = messages.map(toBonsaiMessage);
  const fittedMessages = fitMessagesToContext(bonsaiMessages, {
    contextWindowTokens,
    maxNewTokens: boundedMaxNewTokens,
    countTokens: candidate => countBonsaiPromptTokens(model, candidate, {
      tools: schemas,
      enableThinking,
    }),
  });
  onRequestPrepared?.({
    runtime: "bonsai",
    messages: fittedMessages,
    tools: schemas,
    maxNewTokens: boundedMaxNewTokens,
  });

  const result = await withChatTemplateArgs(model, enableThinking, () => (
    generateToCompletion(
      model,
      fittedMessages,
      {
        tools: schemas,
        maxNewTokens: boundedMaxNewTokens,
        signal,
        preserveControlTokens: true,
        stopMode: schemas.length ? "tool_call" : undefined,
        stopToolNames: schemas.length ? tools.map(tool => tool.name) : undefined,
        tracker: activeTracker,
      },
      onStream,
    )
  ));

  const toolNames = knownTools.map(tool => tool.name);
  const parsed = parseBonsaiToolOutput(result.rawText, toolNames);
  const content = sanitizeExternalText(
    stripBonsaiToolCallSyntax(parsed.content || result.rawText || "", toolNames),
  ).trim();

  return {
    message: {
      role: "assistant",
      content: content || null,
      thinking: parsed.thinking || "",
      tool_calls: parsed.toolCalls.map(call => ({
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    },
    raw: result.rawText,
    metrics: result.metrics,
    truncated: parsed.truncated,
  };
}

function toBonsaiMessage(message) {
  if (message.role === "assistant") {
    const parts = [];
    if (message.thinking) parts.push(message.thinking);
    if (message.tool_calls?.length) {
      parts.push(renderBonsaiToolCalls(message.tool_calls));
    }
    if (message.content) {
      const visibleContent = stripBonsaiToolCallSyntax(message.content);
      if (visibleContent) parts.push(visibleContent);
    }
    return {
      role: "assistant",
      content: parts.join("\n\n").trim(),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: sanitizeExternalText(message.content || ""),
    };
  }
  return {
    role: message.role,
    content: String(message.content || ""),
  };
}
