/** @file Agent loop for tool calling (pi inner-loop semantics). */

import { generateToCompletion } from "./gemma-generate.js";
import {
  parseGemmaToolOutput,
  firstValidWebSearchCall,
  isToolCallOnlyText,
  stripToolCallSyntax,
  collectWebSearchCalls,
  looksLikeToolCallSyntax,
} from "./tool-parser.js";
import { hasCompleteWebSearchToolCall, findCompleteWebSearchCall } from "./tool-call-detector.js";
import { sanitizeExternalText } from "./sanitize.js";
import { inferSearchQuery, lastUserMessageText, looksLikeMultiTopicSearch, userWantsWebSearch } from "./search-intent.js";
import { resolveContextualFreshnessQuery, shouldBypassGenerationOne } from "./contextual-search.js";
import { buildSearchMemory } from "./search-memory.js";
import { splitThinking } from "./messages.js";
import { GenerationTracker, appendThinkingTrace } from "./generation-tracker.js";
import { TOOL_SYNTHESIS_INSTRUCTION, SYNTHESIS_RETRY_NUDGE } from "./tools.js";
import {
  formatQueriesLabel,
  normalizeWebSearchQueries,
  sameQueries,
} from "./web-search-args.js";
import {
  formatMultiSearchResultsForModel,
  totalResultCount,
} from "./multi-search-format.js";
import {
  looksLikeClarificationOnly,
  looksLikeRawSearchDump,
  safeAssistantContent,
} from "./agent-content.js";
import { appearsGrounded } from "./grounding.js";

export const MAX_SEARCH_CALLS = 3;
/** At least one search gen + one or more answer-only synthesis gens. */
export const MAX_MODEL_GENERATIONS = MAX_SEARCH_CALLS + 2;

/**
 * @typedef {object} ToolTraceEntry
 * @property {string} query
 * @property {string[]} [queries]
 * @property {string} provider
 * @property {number} resultCount
 * @property {string} status
 * @property {number} [durationMs]
 */

/**
 * @param {object[]} messages
 * @returns {string|null}
 */
function lastToolResultText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "tool" && m.content && !String(m.tool_call_id || "").includes("_skip_")) {
      return m.content;
    }
  }
  return null;
}

/**
 * @param {string} content
 * @param {string} [raw]
 * @param {{ afterSearch?: boolean, evidence?: string, query?: string }} [options]
 */
export function hasSubstantiveProse(content, raw = "", { afterSearch = false, evidence = "", query = "" } = {}) {
  const out = stripToolCallSyntax(content || raw || "").trim();
  if (!out || out.length < 16) return false;
  if (isToolCallOnlyText(out)) return false;
  if (looksLikeRawSearchDump(out)) return false;
  if (/^Based on web search results:/i.test(out)) return false;
  if (afterSearch && looksLikeClarificationOnly(out)) return false;
  if (afterSearch && evidence && !appearsGrounded(out, evidence, query)) return false;
  return true;
}

/**
 * @param {object[]} working
 * @param {'search' | 'answer'} phase
 * @param {number} synthesisRetries
 * @param {string} [rejectedContent]
 */
function buildMessagesForGeneration(working, phase, synthesisRetries, rejectedContent = "") {
  if (phase !== "answer") return working;
  let msgs = working.map((m, i) => (
    i === 0 && m.role === "system"
      ? { ...m, content: `${m.content}\n\n${TOOL_SYNTHESIS_INSTRUCTION}` }
      : m
  ));
  if (synthesisRetries > 0) {
    if (rejectedContent) {
      msgs = [...msgs, { role: "assistant", content: rejectedContent }];
    }
    msgs = [...msgs, { role: "user", content: SYNTHESIS_RETRY_NUDGE }];
  }
  return msgs;
}

/**
 * @param {string} content
 * @param {object[]} working
 * @param {number} searchCalls
 * @param {boolean} [allowRawFallback]
 */
function finalizeAgentContent(content, working, searchCalls, allowRawFallback = false) {
  const prose = safeAssistantContent(stripToolCallSyntax(content || ""));
  if (hasSubstantiveProse(prose, "", { afterSearch: searchCalls > 0 })) return prose;

  if (looksLikeToolCallSyntax(content) && searchCalls === 0) {
    return "";
  }

    if (allowRawFallback && searchCalls > 0) {
    return (
      "I found relevant web results, but I couldn't produce a sufficiently reliable summary. " +
      "Please review the Search results above or retry."
    );
  }

  return prose || safeAssistantContent(content || "") || "";
}

/**
 * @param {ReturnType<typeof parseGemmaToolOutput>} parsed
 * @param {string} rawText
 * @param {number} gen
 * @param {number} searchCalls
 * @param {object[]} working
 */
function resolveWebSearchPrimary(parsed, rawText, gen, searchCalls, working) {
  let primary = firstValidWebSearchCall(collectWebSearchCalls(rawText, parsed));
  if (primary) return primary;

  const detected = findCompleteWebSearchCall(rawText);
  if (detected?.arguments?.queries?.length) {
    return {
      name: "web_search",
      arguments: { queries: detected.arguments.queries },
    };
  }

  const userText = lastUserMessageText(working);
  if (gen === 0 && searchCalls === 0 && userWantsWebSearch(userText)) {
    const prose = stripToolCallSyntax(parsed.content || rawText).trim();
    const routed = resolveContextualFreshnessQuery(userText, working);

    if (
      routed.freshnessIntentConfidence >= 0.9 &&
      routed.referentResolutionConfidence >= 0.9 &&
      !routed.ambiguous
    ) {
      return {
        name: "web_search",
        arguments: { queries: [routed.query] },
        forced: true,
      };
    }

    if (looksLikeClarificationOnly(prose) && !parsed.toolCalls.length) {
      return null;
    }

    if (
      !routed.ambiguous &&
      routed.freshnessIntentConfidence >= 0.75 &&
      routed.referentResolutionConfidence >= 0.75
    ) {
      return {
        name: "web_search",
        arguments: { queries: [routed.query] },
        forced: true,
      };
    }

    if (!hasSubstantiveProse(prose, rawText) && !routed.ambiguous) {
      return {
        name: "web_search",
        arguments: { queries: [inferSearchQuery(userText, { recentMessages: working })] },
        forced: true,
      };
    }
  }

  return null;
}

/**
 * @param {ReturnType<typeof parseGemmaToolOutput>} parsed
 * @param {string} rawText
 */
function lastResortPrimary(parsed, rawText) {
  if (hasCompleteWebSearchToolCall(rawText)) {
    const tc = firstValidWebSearchCall(collectWebSearchCalls(rawText, parsed));
    if (tc) return tc;
  }
  const visible = parsed.content || rawText || "";
  if (isToolCallOnlyText(visible)) {
    return firstValidWebSearchCall(collectWebSearchCalls(visible));
  }
  return null;
}

/**
 * @param {object} params
 * @param {object} params.model
 * @param {object[]} params.messages - full message list for generate()
 * @param {object[]} params.tools - tool schema for runtime
 * @param {number} params.maxNewTokens
 * @param {AbortSignal} [params.signal]
 * @param {function} [params.onStream]
 * @param {function} [params.onPhase]
 * @param {function} [params.getTracker] - optional shared tracker (UI metrics)
 * @param {function} params.searchFn - async (query, { signal }) => { formatted, results, rawProvider }
 */
export async function runAgentTurn({
  model,
  messages,
  tools,
  maxNewTokens,
  signal,
  onStream,
  onPhase,
  getTracker,
  searchFn,
}) {
  const startLen = messages.length;
  const working = [...messages];
  /** @type {ToolTraceEntry[]} */
  const toolTrace = [];
  let searchCalls = 0;
  let lastRaw = "";
  let lastThinking = "";
  let lastContent = "";
  let lastStopReason = null;
  let accumulatedThinking = "";
  /** @type {object|null} */
  let finalMetrics = null;
  let phase = "search";
  let synthesisRetries = 0;
  let lastRejectedSynthesis = "";
  let lastModelEvidence = "";
  let lastSearchQuery = "";

  if (typeof model.reset === "function") model.reset();

  /**
   * @param {object} params
   * @param {object} params.primary
   * @param {number} params.gen
   * @param {ReturnType<typeof parseGemmaToolOutput>|null} [params.parsed]
   * @param {string} [params.rawText]
   * @returns {Promise<{ aborted?: boolean, finish?: ReturnType<typeof finishTurn> }>}
   */
  async function executeWebSearch({ primary, gen, parsed = null, rawText = "" }) {
    const queries = normalizeWebSearchQueries(primary.arguments);
    const queryLabel = formatQueriesLabel(queries);
    const callId = `call_${Math.max(gen, 0)}_${searchCalls}`;
    const assistantMsg = {
      role: "assistant",
      content: primary.forced || primary.hostResolved
        ? ""
        : stripToolCallSyntax(parsed?.content || ""),
      reasoning: primary.forced || primary.hostResolved ? undefined : (parsed?.thinking || undefined),
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name: "web_search",
            arguments: { queries },
          },
        },
      ],
    };
    working.push(assistantMsg);

    if (parsed?.toolCalls?.length > 1) {
      for (let i = 1; i < parsed.toolCalls.length; i++) {
        const extra = parsed.toolCalls[i];
        working.push({
          role: "tool",
          tool_call_id: `${callId}_skip_${i}`,
          content: `Skipped additional tool call "${extra.name}" (one web_search call per step).`,
        });
      }
    }

    onPhase?.({ phase: "tool_start", query: queryLabel, queries, generation: gen >= 0 ? gen + 1 : 0 });
    const started = performance.now();
    let resultText = "";
    let status = "ok";
    let resultCount = 0;
    let provider = "exa-mcp";
    /** @type {import("./multi-search-format.js").SearchRunResult[]} */
    let searchRuns = [];

    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      searchRuns = await Promise.all(queries.map(async (query) => {
        try {
          const searchResult = await searchFn(query, { signal });
          provider = searchResult.rawProvider ?? provider;
          return {
            query,
            formatted: searchResult.formatted || "No results.",
            results: searchResult.results ?? [],
          };
        } catch (err) {
          if (signal?.aborted || err?.name === "AbortError") throw err;
          return {
            query,
            error: err instanceof Error ? err.message : String(err),
            results: [],
          };
        }
      }));
      resultCount = totalResultCount(searchRuns);
      resultText = sanitizeExternalText(formatMultiSearchResultsForModel(searchRuns));
      lastModelEvidence = resultText;
      lastSearchQuery = queryLabel;
      if (searchRuns.some((run) => run.error)) {
        status = searchRuns.every((run) => run.error) ? "error" : "partial";
      }
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") {
        return {
          aborted: true,
          finish: finishTurn({
            gen: Math.max(gen, 0),
            searchCalls,
            cacheReset: true,
            rawText,
            parsed: parsed || parseGemmaToolOutput(rawText),
            stopReason: lastStopReason,
            content: finalizeAgentContent(lastContent, working, searchCalls),
            thinking: accumulatedThinking || lastThinking,
            metrics: finalMetrics,
            working,
            startLen,
            toolTrace,
            truncated: true,
            aborted: true,
            searchMemory: null,
          }),
        };
      }
      status = "error";
      resultText = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const traceStatus = primary.forced || primary.hostResolved ? `${status}-forced` : status;
    toolTrace.push({
      query: queryLabel,
      queries,
      provider,
      resultCount,
      status: traceStatus,
      durationMs: Math.round(performance.now() - started),
    });


    working.push({
      role: "tool",
      tool_call_id: callId,
      content: resultText,
    });

    onPhase?.({
      phase: "tool_end",
      query: queryLabel,
      queries,
      status,
      resultText,
      resultCount,
      generation: gen >= 0 ? gen + 1 : 0,
    });
    searchCalls++;
    phase = "answer";
    return {};
  }

  const initialUserText = lastUserMessageText(working);
  if (
    initialUserText &&
    userWantsWebSearch(initialUserText) &&
    !looksLikeMultiTopicSearch(initialUserText) &&
    shouldBypassGenerationOne(initialUserText, working)
  ) {
    const routed = resolveContextualFreshnessQuery(initialUserText, working);
    onPhase?.({ phase: "host_resolve", query: routed.query, generation: 0 });
    const hostResult = await executeWebSearch({
      primary: {
        name: "web_search",
        arguments: { queries: [routed.query] },
        forced: true,
        hostResolved: true,
      },
      gen: -1,
    });
    if (hostResult.aborted) return hostResult.finish;
  }

  for (let gen = 0; gen < MAX_MODEL_GENERATIONS; gen++) {
    onPhase?.({
      phase: phase === "answer" ? "synthesize" : "generate",
      generation: gen + 1,
    });

    const cacheReset = gen > 0;
    if (cacheReset && typeof model.reset === "function") {
      model.reset();
    }

    const generationTracker = getTracker?.() ?? new GenerationTracker();
    const toolsForGen = phase === "answer" ? [] : tools;
    const genOpts = {
      tools: toolsForGen,
      maxNewTokens,
      signal,
      preserveControlTokens: true,
      enableThinking: true,
      stopMode: phase === "search" && searchCalls === 0 ? "tool_call" : undefined,
      stopToolNames: phase === "search" && searchCalls === 0 ? ["web_search"] : undefined,
      tracker: generationTracker,
    };

    const streamHandler = onStream
      ? (chunk) => onStream({
        ...chunk,
        generation: gen + 1,
        streamKind: phase === "answer" ? "synthesize" : "generate",
      })
      : undefined;

    const genResult = await generateToCompletion(
      model,
      buildMessagesForGeneration(working, phase, synthesisRetries, lastRejectedSynthesis),
      genOpts,
      streamHandler,
    );
    const { rawText, stopReason, metrics } = genResult;
    lastStopReason = stopReason;
    if (phase === "answer" || metrics?.generatedTokens > 0) {
      finalMetrics = metrics;
    }

    if (signal?.aborted) {
      return finishTurn({
        gen,
        searchCalls,
        cacheReset: true,
        rawText: lastRaw,
        parsed: parseGemmaToolOutput(lastRaw),
        stopReason: lastStopReason,
        content: finalizeAgentContent(lastContent, working, searchCalls),
        thinking: accumulatedThinking || lastThinking,
        metrics: finalMetrics,
        working,
        startLen,
        toolTrace,
        truncated: true,
        aborted: true,
      });
    }

    lastRaw = rawText;
    const parsed = parseGemmaToolOutput(rawText);
    const streamThinking = splitThinking(rawText).thinking;
    lastThinking = streamThinking || parsed.thinking;
    lastContent = parsed.content;
    if (lastThinking) {
      accumulatedThinking = appendThinkingTrace(accumulatedThinking, lastThinking, {
        generation: gen + 1,
        label: phase === "answer" ? "Synthesis" : "Planning",
      });
    }

    if (phase === "answer") {
      const prose = safeAssistantContent(stripToolCallSyntax(lastContent || lastRaw));
      if (hasSubstantiveProse(prose, lastRaw, {
        afterSearch: searchCalls > 0,
        evidence: lastModelEvidence,
        query: lastSearchQuery,
      })) {
        return finishTurn({
          gen,
          searchCalls,
          cacheReset,
          rawText,
          parsed,
          stopReason,
          content: prose,
          thinking: accumulatedThinking || lastThinking,
        metrics: finalMetrics,
          working,
          startLen,
          toolTrace,
          truncated: false,
        });
      }
      if (gen < MAX_MODEL_GENERATIONS - 1) {
        lastRejectedSynthesis = prose;
        synthesisRetries++;
        continue;
      }
      return finishTurn({
        gen,
        searchCalls,
        cacheReset,
        rawText,
        parsed,
        stopReason,
        content: finalizeAgentContent(lastContent, working, searchCalls, true),
        thinking: accumulatedThinking || lastThinking,
        metrics: finalMetrics,
        working,
        startLen,
        toolTrace,
        truncated: true,
      });
    }

    if (parsed.truncated) {
      return finishTurn({
        gen,
        searchCalls,
        cacheReset,
        rawText,
        parsed,
        stopReason,
        content: finalizeAgentContent(lastContent || "(Tool call was incomplete.)", working, searchCalls),
        thinking: accumulatedThinking || lastThinking,
        metrics: finalMetrics,
        working,
        startLen,
        toolTrace,
        truncated: true,
      });
    }

    let primary = resolveWebSearchPrimary(parsed, rawText, gen, searchCalls, working);
    if (!primary) {
      primary = lastResortPrimary(parsed, rawText);
    }

    if (!primary) {
      if (searchCalls > 0) {
        phase = "answer";
        continue;
      }
      return finishTurn({
        gen,
        searchCalls,
        cacheReset,
        rawText,
        parsed,
        stopReason,
        content: finalizeAgentContent(lastContent || lastRaw, working, searchCalls),
        thinking: accumulatedThinking || lastThinking,
        metrics: finalMetrics,
        working,
        startLen,
        toolTrace,
        truncated: false,
      });
    }

    const lastQueries = toolTrace.at(-1)?.queries || [];
    const primaryQueries = normalizeWebSearchQueries(primary.arguments);
    if (searchCalls > 0 && lastQueries.length && sameQueries(lastQueries, primaryQueries)) {
      phase = "answer";
      continue;
    }

    if (searchCalls >= MAX_SEARCH_CALLS) {
      phase = "answer";
      continue;
    }

    const searchOutcome = await executeWebSearch({ primary, gen, parsed, rawText });
    if (searchOutcome.aborted) return searchOutcome.finish;
  }

  return finishTurn({
    gen: MAX_MODEL_GENERATIONS - 1,
    searchCalls,
    cacheReset: true,
    rawText: lastRaw,
    parsed: parseGemmaToolOutput(lastRaw),
    stopReason: lastStopReason,
    content: finalizeAgentContent(lastContent, working, searchCalls, true),
    thinking: accumulatedThinking || lastThinking,
        metrics: finalMetrics,
    working,
    startLen,
    toolTrace,
    truncated: true,
  });
}

/** @param {object} ctx */
function finishTurn(ctx) {
  const searchMemory = ctx.searchMemory ?? (
    ctx.searchCalls > 0 && ctx.toolTrace?.length && hasSubstantiveProse(ctx.content || "", "", { afterSearch: true })
      ? buildSearchMemory({
        query: ctx.toolTrace[ctx.toolTrace.length - 1]?.query || "",
        topic: resolveContextualFreshnessQuery(
          ctx.toolTrace[ctx.toolTrace.length - 1]?.query || "",
          ctx.working || [],
        ).topic || "",
        content: ctx.content,
        retrievedAt: new Date().toISOString(),
      })
      : null
  );

  return {
    content: safeAssistantContent(ctx.content) || ctx.content,
    thinking: ctx.thinking,
    metrics: ctx.metrics ?? null,
    raw: ctx.rawText,
    messages: ctx.working,
    agentTranscript: ctx.working.slice(ctx.startLen),
    toolTrace: ctx.toolTrace,
    searchCalls: ctx.searchCalls,
    searchMemory,
    truncated: ctx.truncated,
    aborted: ctx.aborted || false,
  };
}
