/** @file Gemma runtime adapter for normalized assistant messages. */

import { generateToCompletion } from "./gemma-generate.js";
import { parseGemmaToolOutput, stripToolCallSyntax } from "./tool-parser.js";
import { sanitizeExternalText } from "./sanitize.js";
import { GenerationTracker } from "./generation-tracker.js";
import { fitMessagesToContext } from "./context-window.js";

export const GEMMA_TOOL_PROTOCOL =
  "Emit calls as <|tool_call>call:TOOL_NAME{ARGUMENTS}<tool_call|>. " +
  "Never invent tool results.";

export function countGemmaPromptTokens(
  model,
  messages,
  { tools = [], enableThinking = true } = {},
) {
  if (typeof model?.encodePrompt !== "function") return null;
  const previousTools = model._agentTools;
  const previousThinking = model._enableThinking;
  model._agentTools = tools.length ? tools : null;
  model._enableThinking = enableThinking;
  try {
    return model.encodePrompt(messages).length;
  } finally {
    model._agentTools = previousTools;
    model._enableThinking = previousThinking;
  }
}

export async function generateGemmaAssistant({
  model,
  messages,
  tools,
  knownTools = tools,
  maxNewTokens,
  contextWindowTokens,
  signal,
  onStream,
  tracker,
}) {
  const activeTracker = tracker || new GenerationTracker();
  const schemas = tools.map(tool => tool.schema);
  const gemmaMessages = messages.map(toGemmaMessage);
  const fittedMessages = fitMessagesToContext(gemmaMessages, {
    contextWindowTokens,
    maxNewTokens,
    countTokens: candidate => countGemmaPromptTokens(model, candidate, {
      tools: schemas,
      enableThinking: true,
    }),
  });
  const result = await generateToCompletion(
    model,
    fittedMessages,
    {
      tools: schemas,
      maxNewTokens,
      signal,
      preserveControlTokens: true,
      enableThinking: true,
      stopMode: schemas.length ? "tool_call" : undefined,
      stopToolNames: schemas.length ? tools.map(tool => tool.name) : undefined,
      tracker: activeTracker,
    },
    onStream,
  );
  const toolNames = knownTools.map(tool => tool.name);
  const parsed = parseGemmaToolOutput(result.rawText, toolNames);
  const content = sanitizeExternalText(
    stripToolCallSyntax(parsed.content || result.rawText || "", toolNames),
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

function toGemmaMessage(message) {
  if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
    return {
      role: "assistant",
      content: message.content || "",
      reasoning: message.thinking || undefined,
      tool_calls: message.tool_calls.map(call => ({
        ...call,
        function: {
          ...call.function,
          arguments: parseArguments(call.function?.arguments),
        },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: sanitizeExternalText(message.content || ""),
    };
  }
  return { role: message.role, content: message.content || "" };
}

function parseArguments(value) {
  if (typeof value !== "string") return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
