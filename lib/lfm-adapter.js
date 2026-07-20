/** @file LFM runtime adapter for normalized assistant messages and tools. */

import { fitMessagesToContext } from "./context-window.js";
import { GenerationTracker } from "./generation-tracker.js";
import {
  parseLfmToolOutput,
  renderLfmToolCalls,
} from "./lfm-tool-parser.js";
import { sanitizeExternalText } from "./sanitize.js";

export const LFM_TOOL_PROTOCOL =
  "When invoking a tool, use LFM2.5 native syntax exactly: " +
  "<|tool_call_start|>[TOOL_NAME(argument=value)]<|tool_call_end|>. " +
  "Use named arguments and put multiple calls in the same list. Never invent tool results.";

function toolDefinition(tool) {
  return tool.schema?.function || tool.schema || {};
}

function appendToolDefinitions(messages, tools) {
  const definitions = tools.map(toolDefinition);
  if (!definitions.length) return messages;
  const declaration = `List of tools: ${JSON.stringify(definitions)}`;
  const output = messages.map(message => ({ ...message }));
  const systemIndex = output.findIndex(message => message.role === "system");
  if (systemIndex === -1) {
    output.unshift({ role: "system", content: declaration });
  } else {
    output[systemIndex].content =
      `${String(output[systemIndex].content || "").trim()}\n\n${declaration}`;
  }
  return output;
}

function toLfmMessage(message) {
  if (message.role === "assistant" && message.tool_calls?.length) {
    const callText = renderLfmToolCalls(message.tool_calls);
    return {
      role: "assistant",
      content: [callText, message.content].filter(Boolean).join("\n"),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: sanitizeExternalText(String(message.content || "")),
    };
  }
  return {
    role: message.role,
    content: String(message.content || ""),
  };
}

export function toLfmMessages(messages, tools = []) {
  return appendToolDefinitions(messages.map(toLfmMessage), tools);
}

export function countLfmPromptTokens(model, messages, { tools = [] } = {}) {
  if (typeof model?.encodePrompt !== "function") return null;
  return model.encodePrompt(toLfmMessages(messages, tools)).length;
}

async function generateToCompletion(model, messages, options, onStream) {
  let rawText = "";
  const tracker = options.tracker || new GenerationTracker();
  for await (const chunk of model.generate(messages, options)) {
    onStream?.(chunk);
    tracker.onToken();
    rawText = chunk.rawText ?? chunk.text ?? rawText;
    if (options.signal?.aborted) break;
  }
  return { rawText, metrics: tracker.snapshot() };
}

export async function generateLfmAssistant({
  model,
  messages,
  tools,
  knownTools = tools,
  maxNewTokens,
  contextWindowTokens,
  signal,
  onStream,
  onRequestPrepared,
  tracker,
}) {
  const fittedMessages = fitMessagesToContext(messages, {
    contextWindowTokens,
    maxNewTokens,
    countTokens: candidate => countLfmPromptTokens(model, candidate, { tools }),
  });
  const runtimeMessages = toLfmMessages(fittedMessages, tools);
  onRequestPrepared?.({
    runtime: "lfm2",
    messages: runtimeMessages,
    tools: tools.map(tool => tool.schema),
    maxNewTokens,
  });
  const result = await generateToCompletion(
    model,
    runtimeMessages,
    { maxNewTokens, signal, tracker, preserveControlTokens: true },
    onStream,
  );
  const parsed = parseLfmToolOutput(
    result.rawText,
    knownTools.map(tool => tool.name),
  );
  return {
    message: {
      role: "assistant",
      content: sanitizeExternalText(parsed.content).trim() || null,
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
