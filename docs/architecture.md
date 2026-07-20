# WebLLM current architecture

This document describes the implementation shipped from this repository and is
the source of truth for current behavior.

## Runtime boundary

WebLLM is a static browser application. `index.html` owns the document shell and
styles; `app.js` owns DOM state, streaming, session actions, and the model/cache
lifecycle. `lib/runtime-registry.js` is the single dispatch point for runtime
loading, token counting, chat options, tool protocol, and agent adapter selection.
Testable behavior lives in `lib/`. There is no application backend or server-side
model inference.

The supported registry in `lib/models.js` currently contains:

- `gemma4`: Gemma 4 E2B mobile-QAT, loaded from the vendored `gemma-4-e2b.js` WebGPU runtime.
- `bonsai27b`: Bonsai 27B GGUF Q1_0, loaded from the vendored `bonsai-27b.js` WebGPU runtime.
- `lfm2`: LFM2.5 230M GGUF, loaded from `lfm2_5.js`.
- `lfm2_350`: LFM2.5 350M GGUF, loaded from `lfm2_5.js`.

Gemma 4 E4B is not registered or loadable.

## Data flow and privacy

Inference runs locally through WebGPU. Chat sessions and conversation-scoped text
attachments are persisted in the `webllm-sessions` IndexedDB database; preferences
and theme are stored in `localStorage`. The database uses separate `sessions` and
`attachments` stores, with attachments indexed by `sessionId`. Session deletion
cascades to its files and startup removes orphan attachment records. Model weights
are fetched from Hugging Face and cached by the model runtime:

Attachment quotas use normalized `storedBytes`, because that is the representation
actually retained in IndexedDB; the original per-file size is still capped before
decoding to bound ingestion work.

- Gemma safetensors use IndexedDB chunks plus Cache Storage metadata/configuration.
- GGUF models (Bonsai, LFM2) store weight chunks in IndexedDB under each model's
  `cacheName` (object stores `chunks` + `meta`), with optional response headers in
  Cache Storage (`${cacheName}-headers`). WebLLM introspection must not force an
  IndexedDB version during read-only checks.

If Web Search is disabled, prompts, generated content, chat history, and uploaded
files remain in the browser. File selection is user-initiated and grants access
only to normalized text copied into the active conversation's virtual workspace;
the app does not retain filesystem paths or handles. When enabled, the `web_search` tool sends normalized queries to the
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

`lib/web-search-tool.js` owns web-specific query normalization, per-turn
deduplication, Exa execution, formatting, and metadata. `lib/file-tools.js` creates
conversation-scoped `read` and regex/literal `grep` registrations.
`lib/tool-registry.js` is the single active-tool construction point used by live
turns and diagnostic exports. Declarative descriptors and
`resolveToolAvailability()` provide preferred, eligible, active, conflict, and
disabled-reason state for every tool. Per-conversation preferences are stored in
one `toolPreferences` map. Model-specific excerpt and result budgets live with
model capabilities in `lib/models.js`. Regex scans run in disposable module
workers with a strict deadline; literal scans retain the cooperative main-thread
implementation. Both local tools are enabled when files are uploaded and may be
disabled afterward. Agent mode is active whenever the resolver returns at least
one active local or web tool.

Conversation history is measured with the loaded model's tokenizer before generation.
The input budget is the model's declared context window minus the requested output tokens
and a small safety reserve (`CONTEXT_SAFETY_TOKENS`, default 256). On small context
windows, `capMaxNewTokensForContext()` also enforces a minimum input budget (512 tokens)
so prompt fitting does not collapse to a single token. If trimming is required, it removes whole oldest user turns so
assistant tool calls and matching tool results are never split. The current turn is never
shortened. Web-search evidence is preserved as returned by the provider.

## Tool protocol and safety

Runtime adapters are the model-protocol boundary, selected only through
`lib/runtime-registry.js`. `lib/gemma-adapter.js` converts canonical messages to
the Gemma runtime shape and normalizes Gemma thinking and tool-call output.
`lib/bonsai-adapter.js` maps canonical messages to Qwen ChatML, passes tool schemas
and chat-template arguments, stops generation at complete `</tool_call>` blocks,
and parses XML tool output via `lib/bonsai-tool-parser.js`; thinking is disabled
for the currently registered Bonsai model. `lib/lfm-adapter.js` injects tool
definitions, renders canonical history using LFM2.5's native Python-style function
calls, and parses calls wrapped in `<|tool_call_start|>` /
`<|tool_call_end|>`. The tool registry and bounded loop remain independent of
these runtime protocols.

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
sanitized against Gemma, LFM, and Bonsai prompt/tool boundary tokens before entering a
model transcript.

Local file registrations contribute a metadata-only workspace manifest and an
uploaded-data trust guard. User messages persist optional stable `fileRefs` IDs.
`lib/file-context.js` resolves those IDs immediately before generation and appends
bounded, line-numbered excerpts without mutating the durable message. Missing or
removed IDs are ignored. References are explicit: autocomplete or a workspace-row
selection adds an ID, while free `@filename` text never does. Composer and
historical editing use selected-ID sets and the mention parser only removes
selections whose mentions disappeared. References are inactive when both local
tools are disabled. `read` and `grep` outputs are sanitized through the same
control-token boundary before entering the model transcript. Virtual filenames
preserve user-visible model-token-like text by design after path separators and
operating-system control characters are removed; only file contents and tool
results receive model control-token stripping.

`scripts/bonsai-tool-stop-inline.mjs` supplies the Qwen XML stop scanner injected
into `bonsai-27b.js`. `scripts/patch-bonsai-runtime.mjs` patches control-token
preservation, `rawText`, tool schema injection, and early stop in the vendored bundle.

`scripts/tool-call-stop-inline.mjs` contains the equivalent self-contained scanner injected into `gemma-4-e2b.js`. `scripts/patch-gemma-tool-support.mjs` accepts exactly the current upstream or already-patched bundle so upstream drift fails visibly.
`scripts/patch-lfm-tool-support.mjs` makes the smaller LFM runtime expose decoded
control tokens only when its adapter requests them; ordinary chat decoding is unchanged.

## Rendering and persistence shape

`session.messages` is the single durable chronological transcript. It contains
`user`, `assistant`, and `tool` messages directly. User messages may contain
`fileRefs`; assistant messages may contain `thinking`, `tool_calls`, and generation
metrics; tool messages may contain execution metadata. File content is stored once
in the attachment store, never copied into canonical messages.

During generation, the UI derives temporary steps directly from loop events and canonical draft messages. Prefill appears as a temporary runtime-status card with live metrics and is never persisted. A thinking card exists only when the model supports thinking or the current assistant message contains thinking text; tool calls, tool results, and answers render separately. Streaming uses `splitModelThinking(raw, runtime)` so each runtime's control tokens map to the correct panel. Streaming cards are finalized in place, unchanged Markdown is not re-rendered, and historical messages do not replay entry animations.

Each tool invocation gets a conversation-scoped call ID; its matching `tool_call_id`
refers to that invocation, while `function.name` identifies `read`, `grep`, or
`web_search`.

Sessions use `You are a helpful assistant.` as the default system prompt value,
not merely as a textarea placeholder.

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
`exportSessionTrace(session)` as an opt-in diagnostic format. Runtime adapters
report each post-fitting request immediately before generation. The latest turn's
requests are retained in memory and export with `exact_runtime_capture`
provenance. After reload, the exporter instead produces an explicitly labelled
`reconstructed_current_context` snapshot. This distinction prevents current files
or settings from being mistaken for the request that produced an earlier result.
Diagnostic export requires explicit format selection and may include bounded file
excerpts. Complete attachment records and raw `File` objects are never exported.
Thinking is omitted only at the OpenAI export boundary.

## Runtime influences

The agent loop borrows the bounded inner-turn idea from pi.dev. The Gemma runtime and kernel work are informed by the public `webml-community/gemma-4-webgpu-kernels` Hugging Face Space. Those projects are references, not runtime dependencies or claims that E4B is already supported here.
