# WebLLM current architecture

This document describes the implementation that is shipped from this repository. It is the source of truth for behavior; older proposals and investigation transcripts are intentionally not retained as design specifications.

## Runtime boundary

WebLLM is a static browser application. `index.html` owns the document shell and
styles; `app.js` owns DOM state, streaming, session actions, and the model/cache
lifecycle. `lib/runtime-registry.js` is the single dispatch point for runtime
loading, token counting, chat options, tool protocol, and agent adapter selection.
Testable behavior lives in `lib/`. There is no application backend or server-side
model inference.

The supported registry in `lib/models.js` currently contains:

- `gemma4`: Gemma 4 E2B mobile-QAT, loaded from the vendored `gemma-4-e2b.js` WebGPU runtime.
- `lfm2`: LFM2.5 230M GGUF, loaded from `lfm2_5.js`.
- `lfm2_350`: LFM2.5 350M GGUF, loaded from `lfm2_5.js`.

Gemma 4 E4B is not registered or loadable.

## Data flow and privacy

Inference runs locally through WebGPU. Chat sessions are persisted in the `webllm-sessions` IndexedDB database; preferences and theme are stored in `localStorage`. Model weights are fetched from Hugging Face and cached by the model runtime:

- Gemma safetensors use IndexedDB chunks plus Cache Storage metadata/configuration.
- LFM2 GGUF files use Cache Storage, with a separate cache name for each model.

If Web Search is disabled, prompts, generated content, and chat history remain in
the browser. When enabled, the `web_search` tool sends normalized queries to the
third-party Exa MCP endpoint. Exa results are sanitized, preserved in full as
returned, shown in agent steps, and supplied to the local model as evidence.
Search is the intentional network exception.

IndexedDB and `localStorage` failures degrade to an in-memory session state where possible. A browser `file://` origin can run some UI code but cannot provide the normal cache/persistence behavior; use an HTTP(S) origin for testing.

## Agent loop

`lib/agent-loop.js` is a model- and tool-agnostic bounded transcript loop:

1. Generate from recent complete conversation turns within the configured history budget.
2. If the model answers, return that answer without host-side quality classification.
3. If the model requests tools, resolve each name in the registry, execute calls sequentially unless every call is explicitly parallel-safe, and append their results.
4. Generate again from that expanded transcript, allowing up to three tool rounds.
5. After the tool limit, run one final generation with tools disabled.

The loop emits `generation_start`, `message_end`, `tool_start`, and `tool_end`
events. Before each model call it asks the caller to prepare messages with the
currently active tools. This rebuilds tool policy for every generation and removes
both policy and declarations from the final tools-disabled generation. The loop
does not infer freshness, compact memory, classify answer quality, or retry
answers. Aborts are checked before every generation and tool round, forwarded
through search and runtime generation, and return partial state.

`lib/web-search-tool.js` owns web-specific query normalization, per-turn deduplication, Exa execution, formatting, and metadata. The loop only sees a `{ name, schema, execute }` registry entry.

Conversation history is measured with the loaded model's tokenizer before generation.
The input budget is the model's declared context window minus the requested output tokens
and a small safety reserve. If trimming is required, it removes whole oldest user turns so
assistant tool calls and matching tool results are never split. The current turn is never
shortened. Web-search evidence is preserved as returned by the provider.

## Tool protocol and safety

Runtime adapters are the model-protocol boundary, selected only through
`lib/runtime-registry.js`. `lib/gemma-adapter.js` converts
canonical messages to the Gemma runtime shape and normalizes Gemma thinking and
tool-call output. `lib/lfm-adapter.js` injects tool definitions, renders canonical
history using LFM2.5's native Python-style function calls, and parses calls wrapped
in `<|tool_call_start|>` / `<|tool_call_end|>`. The tool registry and bounded loop
remain independent of either runtime.

`lib/tool-call-syntax.js` supplies balanced Gemma call scanning:

- balanced braces handle nested objects, arrays, escaped quote tokens, and regular quoted strings;
- calls inside an open thought channel are ignored;
- incomplete calls are marked truncated and are never executed;
- arbitrary declared tool names are supported.

The LFM parser accepts multiple calls and nested string, number, boolean, list, and
object arguments. It also accepts the bare `[tool_name(...)]` form produced by
decoders that strip LFM control tokens. Unknown, malformed, and incomplete calls
are never executed.

Prompt policies belong to registered tools. The web-search registration contributes its
freshness and result-synthesis policies only while that tool is active; tools whose output
is marked as external also enable the external-data guard. External text is
sanitized against both Gemma and LFM prompt/tool boundary tokens before entering a
model transcript.

`scripts/tool-call-stop-inline.mjs` contains the equivalent self-contained scanner injected into `gemma-4-e2b.js`. `scripts/patch-gemma-tool-support.mjs` accepts exactly the current upstream or already-patched bundle so upstream drift fails visibly.
`scripts/patch-lfm-tool-support.mjs` makes the smaller LFM runtime expose decoded
control tokens only when its adapter requests them; ordinary chat decoding is unchanged.

## Rendering and persistence shape

`session.messages` is the single durable chronological transcript. It contains `user`, `assistant`, and `tool` messages directly. Assistant messages may contain `thinking`, `tool_calls`, and generation metrics; tool messages may contain execution metadata. Older embedded `agentSteps`, `toolTrace`, and `toolTranscript` records are flattened when loaded.

During generation, the UI derives temporary steps directly from loop events and canonical draft messages. Prefill appears as a temporary runtime-status card with live metrics and is never persisted. A thinking card exists only when the current assistant message contains thinking; tool calls, tool results, and answers render separately. Streaming cards are finalized in place, unchanged Markdown is not re-rendered, and historical messages do not replay entry animations.

Each tool invocation gets a conversation-scoped call ID; its matching `tool_call_id` refers to that invocation, while `function.name` identifies `web_search`. Duplicate IDs from older records are repaired when messages are rebuilt or exported.

New sessions use `You are a helpful assistant.` as the actual system prompt value, not merely as a textarea placeholder. Empty legacy prompt values normalize to the same default.

At model-call and export boundaries, every system prompt is augmented with the January 2025 knowledge cutoff and the browser's current local date. The editable stored prompt remains unchanged.

Canonical tool use has this shape:

```js
{ role: "user", content: "..." }
{ role: "assistant", content: null, thinking: "...", tool_calls: [...] }
{ role: "tool", tool_call_id: "...", content: "...", meta: { status, resultCount } }
{ role: "assistant", content: "...", thinking: "...", meta: { tokens, tps, ttft } }
```

`exportSessionOpenAI(session)` emits tool calls/results in Chat Completions order: an assistant message with `tool_calls`, a `tool` message for each call, and the final assistant message.

The download dialog keeps that portable export as the default and offers
`exportSessionTrace(session)` as an opt-in diagnostic format. The caller supplies
the actual active tool registrations; the message/export layer contains no
hardcoded web-search specification. Trace download requires explicit format
selection and confirmation. Requests made during generation are queued until the
response finishes so browser file-download UI cannot interrupt inference. The
full trace includes effective model context, prompt layers, the latest recorded
execution mode, canonical messages, thinking, metrics, tool metadata, and portable
OpenAI messages. Thinking is omitted only at the OpenAI export boundary.

## Runtime influences

The agent loop borrows the bounded inner-turn idea from pi.dev. The Gemma runtime and kernel work are informed by the public `webml-community/gemma-4-webgpu-kernels` Hugging Face Space. Those projects are references, not runtime dependencies or claims that E4B is already supported here.
