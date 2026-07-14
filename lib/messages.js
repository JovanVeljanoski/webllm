/** @file Model message construction and conversation exports. */

import {
  EXTERNAL_TOOL_DATA_GUARD,
  WEB_SEARCH_TOOL_SPEC,
} from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./constants.js";
import { sanitizeExternalText } from "./sanitize.js";
export { splitThinking } from "./tool-parser.js";

export function buildRuntimeDateContext(now = new Date()) {
  const currentDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  return `Your knowledge cutoff is January 2025.\nToday is: ${currentDate}.`;
}

export function appendRuntimeDateContext(base, now = new Date()) {
  return [String(base || "").trim(), buildRuntimeDateContext(now)]
    .filter(Boolean)
    .join("\n\n");
}

export function buildGrammarSuffix({ grammarMode, jsonSchema = "", ebnf = "" } = {}) {
  if (grammarMode === "off") return "";
  if (grammarMode === "json") {
    const schema = jsonSchema.trim();
    let block = "\n\n[GRAMMAR — respond with valid JSON only. No markdown fences, no prose outside JSON.]";
    block += schema ? `\nConform to this JSON Schema:\n${schema}` : "\nOutput a single valid JSON value.";
    return block;
  }
  if (grammarMode === "ebnf") {
    const trimmed = ebnf.trim();
    if (!trimmed) return "";
    return `\n\n[GRAMMAR — output only text matching this EBNF. No explanation.]\n\`\`\`ebnf\n${trimmed}\n\`\`\``;
  }
  return "";
}

export function buildEffectiveSystemPrompt(base, grammarConfig) {
  const trimmed = appendRuntimeDateContext(base);
  const suffix = buildGrammarSuffix(grammarConfig);
  return trimmed || suffix ? trimmed + suffix : "";
}

export function buildMessages(session, grammarConfig) {
  const messages = [];
  const system = buildEffectiveSystemPrompt(
    session.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    grammarConfig,
  );
  if (system) messages.push({ role: "system", content: system });
  for (const message of session.messages || []) {
    if (message.role === "user") {
      messages.push({ role: "user", content: String(message.content || "") });
    } else if (message.role === "assistant" && message.content) {
      messages.push({ role: "assistant", content: String(message.content) });
    }
  }
  return messages;
}

const DEFAULT_TOOL_PROTOCOL = "Never invent tool results.";

function buildAgentPolicy(tools, toolProtocol = DEFAULT_TOOL_PROTOCOL) {
  if (!tools.length) return [];
  const toolNames = tools.map(tool => tool.name).filter(Boolean).join(", ");
  const protocol =
    `You may use these declared tools when needed: ${toolNames}. ` +
    toolProtocol;
  const toolPolicies = tools.flatMap(tool =>
    Array.isArray(tool.promptPolicy) ? tool.promptPolicy : []);
  const externalGuard = tools.some(tool => tool.resultTrust === "external")
    ? [EXTERNAL_TOOL_DATA_GUARD]
    : [];
  return [protocol, ...new Set(toolPolicies), ...externalGuard];
}

export function buildAgentMessages(
  session,
  tools = [],
  { toolProtocol = DEFAULT_TOOL_PROTOCOL } = {},
) {
  const messages = [];
  const base = appendRuntimeDateContext(
    session.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  );
  const system = [base, ...buildAgentPolicy(tools, toolProtocol)]
    .filter(Boolean)
    .join("\n\n");
  if (system) messages.push({ role: "system", content: system });
  messages.push(...(session.messages || []));
  return messages;
}

function toOpenAIMessage(message) {
  if (message.role === "assistant") {
    const out = {
      role: "assistant",
      content: message.content == null ? null : String(message.content),
    };
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      out.tool_calls = message.tool_calls.map(call => ({
        id: String(call.id),
        type: "function",
        function: {
          name: String(call.function?.name || ""),
          arguments: typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments || {}),
        },
      }));
    }
    return out;
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: String(message.tool_call_id || ""),
      content: sanitizeExternalText(String(message.content || "")),
    };
  }
  if (message.role === "user" || message.role === "system") {
    return { role: message.role, content: String(message.content || "") };
  }
  return null;
}

/** OpenAI Chat Completions messages including tool calls and results. */
export function exportSessionOpenAI(session) {
  const messages = [];
  const system = appendRuntimeDateContext(
    session.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  );
  if (system) messages.push({ role: "system", content: system });
  messages.push(...(session.messages || []).map(toOpenAIMessage).filter(Boolean));
  return messages;
}

export function exportSessionTrace(
  session,
  {
    agentMode,
    grammarConfig = { grammarMode: "off" },
    toolProtocol = DEFAULT_TOOL_PROTOCOL,
  } = {},
) {
  const effectiveAgentMode =
    agentMode ?? (session.lastExecution?.mode === "agent");
  const activeTools = effectiveAgentMode ? [WEB_SEARCH_TOOL_SPEC] : [];
  const runtimeMessages = effectiveAgentMode
    ? buildAgentMessages(session, activeTools, { toolProtocol })
    : buildMessages(session, grammarConfig);
  return {
    format: "webllm-full-trace",
    version: 2,
    session: {
      id: session.id || null,
      title: session.title || "Untitled",
      modelId: session.modelId || null,
      createdAt: session.createdAt || null,
      updatedAt: session.updatedAt || null,
      systemPrompt: session.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
    modelContext: {
      mode: effectiveAgentMode ? "agent" : "chat",
      messages: runtimeMessages.map(toOpenAIMessage).filter(Boolean),
      tools: activeTools.map(tool => tool.schema),
    },
    promptLayers: {
      systemPrompt: session.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      runtimeDateContext: buildRuntimeDateContext(),
      grammarSuffix: effectiveAgentMode ? "" : buildGrammarSuffix(grammarConfig),
      agentPolicy: buildAgentPolicy(activeTools, toolProtocol),
    },
    execution: session.lastExecution
      ? structuredClone(session.lastExecution)
      : null,
    openaiMessages: exportSessionOpenAI(session),
    messages: (session.messages || []).map(message => structuredClone(message)),
  };
}
