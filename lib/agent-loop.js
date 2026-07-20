/** @file Generic bounded message/tool loop. */

export const MAX_TOOL_ROUNDS = 3;
export const MAX_MODEL_GENERATIONS = MAX_TOOL_ROUNDS + 1;
export const MAX_TOOL_CALLS_PER_GENERATION = 4;
export const MAX_TOOL_CALLS_PER_TURN = 8;

const TOOL_LIMIT_MESSAGE =
  "I reached the tool-use limit before I could complete this request.";
const INCOMPLETE_TOOL_MESSAGE =
  "I could not produce a valid tool request, so I cannot complete this request reliably.";

let turnSequence = 0;

function callIdPrefix(prefix) {
  const normalized = String(prefix || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  if (normalized) return normalized;
  turnSequence++;
  return `turn_${Date.now().toString(36)}_${turnSequence}`;
}

function finish({
  working,
  newMessages,
  raw,
  metrics,
  truncated = false,
  aborted = false,
}) {
  const finalAssistant = [...newMessages].reverse()
    .find(message => message.role === "assistant" && !message.tool_calls?.length);
  return {
    content: finalAssistant?.content || "",
    thinking: finalAssistant?.thinking || "",
    metrics: metrics ?? null,
    raw,
    messages: working,
    newMessages,
    generations: newMessages.filter(message => message.role === "assistant").length,
    toolCalls: newMessages.reduce(
      (count, message) => count + (message.tool_calls?.length || 0),
      0,
    ),
    truncated,
    aborted,
  };
}

/**
 * @param {object} params
 * @param {object[]} params.messages
 * @param {{ name: string, schema: object, execute: function }[]} params.tools
 * @param {function} params.generateFn
 * @param {function} [params.prepareMessages]
 * @param {object} params.model
 * @param {number} params.maxNewTokens
 * @param {number} [params.contextWindowTokens]
 * @param {number} [params.maxToolRounds]
 * @param {AbortSignal} [params.signal]
 * @param {function} [params.onStream]
 * @param {function} [params.onEvent]
 * @param {function} [params.onRequestPrepared]
 * @param {function} [params.getTracker]
 * @param {string} [params.callIdPrefix]
 */
export async function runAgentTurn({
  messages,
  tools,
  generateFn,
  prepareMessages,
  model,
  maxNewTokens,
  contextWindowTokens,
  maxToolRounds = MAX_TOOL_ROUNDS,
  signal,
  onStream,
  onEvent,
  onRequestPrepared,
  getTracker,
  callIdPrefix: requestedPrefix,
}) {
  const working = structuredClone(messages);
  const newMessages = [];
  const toolByName = new Map(tools.map(tool => [tool.name, tool]));
  const prefix = callIdPrefix(requestedPrefix);
  let toolRounds = 0;
  let raw = "";
  let metrics = null;
  let totalToolCalls = 0;

  for (let generation = 0; generation <= maxToolRounds; generation++) {
    if (signal?.aborted) {
      return finish({
        working,
        newMessages,
        raw,
        metrics,
        truncated: true,
        aborted: true,
      });
    }
    const activeTools =
      toolRounds < maxToolRounds && totalToolCalls < MAX_TOOL_CALLS_PER_TURN
        ? tools
        : [];
    const generationMessages = prepareMessages
      ? prepareMessages(working, activeTools)
      : working;
    onEvent?.({ type: "generation_start", generation: generation + 1 });

    const generated = await generateFn({
      model,
      messages: generationMessages,
      tools: activeTools,
      knownTools: tools,
      maxNewTokens,
      contextWindowTokens,
      signal,
      tracker: getTracker?.(),
      onRequestPrepared: request => onRequestPrepared?.({
        generation: generation + 1,
        ...request,
      }),
      onStream: onStream
        ? chunk => onStream({ ...chunk, generation: generation + 1 })
        : undefined,
    });
    raw = generated.raw || "";
    metrics = generated.metrics;

    const generatedCalls = generated.message.tool_calls || [];
    let content = generated.message.content;
    if (!activeTools.length && generatedCalls.length && !content) {
      content = TOOL_LIMIT_MESSAGE;
    } else if (generated.truncated && !generatedCalls.length && !content) {
      content = INCOMPLETE_TOOL_MESSAGE;
    }
    const message = {
      role: "assistant",
      content,
    };
    if (generated.message.thinking) message.thinking = generated.message.thinking;
    if (metrics) message.meta = metrics;
    const remainingCalls = MAX_TOOL_CALLS_PER_TURN - totalToolCalls;
    const requestedCalls = activeTools.length
      ? generatedCalls.slice(
        0,
        Math.min(MAX_TOOL_CALLS_PER_GENERATION, remainingCalls),
      )
      : [];
    if (requestedCalls.length) {
      totalToolCalls += requestedCalls.length;
      message.tool_calls = requestedCalls.map((call, index) => ({
        id: `call_${prefix}_${generation}_${index}`,
        type: "function",
        function: {
          name: String(call.function?.name || ""),
          arguments: call.function?.arguments || {},
        },
      }));
    }

    working.push(message);
    newMessages.push(message);
    onEvent?.({ type: "message_end", message, generation: generation + 1 });

    if (signal?.aborted) {
      return finish({
        working,
        newMessages,
        raw,
        metrics,
        truncated: true,
        aborted: true,
      });
    }
    if (!message.tool_calls?.length) {
      return finish({
        working,
        newMessages,
        raw,
        metrics,
        truncated: generated.truncated,
      });
    }

    toolRounds++;
    let toolMessages;
    try {
      const executeCall = async call => {
        const tool = toolByName.get(call.function.name);
        onEvent?.({
          type: "tool_start",
          toolCall: call,
          toolName: call.function.name,
          args: call.function.arguments,
        });
        let result;
        try {
          if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
          result = await tool.execute(call.function.arguments, { signal });
        } catch (error) {
          const aborted = !!signal?.aborted;
          result = aborted
            ? {
              content: "Tool execution was aborted.",
              meta: { status: "aborted" },
            }
            : {
              content: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
              meta: { status: "error" },
            };
        }
        const toolMessage = {
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: String(result?.content || ""),
          meta: result?.meta || null,
        };
        onEvent?.({
          type: "tool_end",
          toolCall: call,
          toolName: call.function.name,
          message: toolMessage,
        });
        return toolMessage;
      };
      const parallel = message.tool_calls.every(
        call => toolByName.get(call.function.name)?.parallelSafe === true,
      );
      if (parallel) {
        toolMessages = await Promise.all(message.tool_calls.map(executeCall));
      } else {
        toolMessages = [];
        for (const call of message.tool_calls) {
          toolMessages.push(await executeCall(call));
        }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        return finish({
          working,
          newMessages,
          raw,
          metrics,
          truncated: true,
          aborted: true,
        });
      }
      throw error;
    }

    working.push(...toolMessages);
    newMessages.push(...toolMessages);
    if (signal?.aborted) {
      return finish({
        working,
        newMessages,
        raw,
        metrics,
        truncated: true,
        aborted: true,
      });
    }
  }

  return finish({
    working,
    newMessages,
    raw,
    metrics,
    truncated: true,
  });
}
