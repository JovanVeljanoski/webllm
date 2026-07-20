# Bonsai 27B runtime

This document describes the Bonsai 27B integration currently shipped in this
repository and the reasons behind its runtime constraints.

## Model registration

`lib/models.js` registers Bonsai as:

- model ID: `bonsai27b`;
- runtime: `bonsai`;
- weights: GGUF from the configured Hugging Face repository and revision;
- approximate download: 3.9 GB;
- declared context window: 4,096 tokens;
- default maximum output: 1,024 tokens;
- thinking UI: disabled;
- tool calling: enabled.

The model appears after Gemma and before the smaller LFM models in the picker.
Its weights use the same browser-local GGUF cache infrastructure as LFM, with a
model-specific cache name.

## Runtime boundary

`lib/runtime-registry.js` loads the vendored `bonsai-27b.js` runtime only when the
model is selected. `lib/bonsai-adapter.js` is the canonical-message boundary.

The adapter:

- maps canonical history to the runtime's Qwen ChatML representation;
- supplies active tool schemas through the chat template;
- sets `enable_thinking: false` and `preserve_thinking: true`;
- measures prompts with the same template and active schemas used for generation;
- fits complete conversation turns to the 4K context window;
- stops decoding at a complete XML tool call;
- normalizes generated text into canonical assistant messages;
- reports the exact fitted request through `onRequestPrepared` for diagnostics.

Keeping protocol conversion inside the adapter prevents Bonsai-specific XML and
template behavior from leaking into the generic agent loop.

## Tool-call protocol

Bonsai calls tools with:

```xml
<tool_call>
<function=TOOL_NAME>
<parameter=ARGUMENT_NAME>
value
</parameter>
</tool_call>
```

`lib/bonsai-tool-parser.js` accepts complete calls for any currently declared tool
name. It supports string, number, boolean, object, and list values used by the
shared web and local-file schemas. Unknown, malformed, incomplete, or
thinking-contained calls are never executed.

The vendored runtime stop scanner recognizes a complete `</tool_call>` boundary so
generation can stop before the model emits unnecessary follow-up text. The generic
loop then appends canonical assistant and tool-result messages and starts the next
generation.

## Thinking behavior

The registered model currently runs with thinking disabled. The adapter and parser
still understand `<think>` and `<redacted_thinking>` blocks so leaked or preserved
reasoning never appears as ordinary answer text.

The thinking panel remains hidden for Bonsai unless a future registered model
explicitly enables that capability.

## Context handling

Bonsai's 4,096-token context is the main operational constraint.

Before generation:

1. requested output is capped to 1,024 tokens;
2. 256 safety tokens are reserved;
3. at least 512 tokens are preserved for input;
4. the loaded tokenizer measures the fully templated prompt and active schemas;
5. oldest complete user turns are removed when needed;
6. the current turn is never silently shortened.

If the current turn still cannot fit, generation fails with an actionable context
message.

Local-file limits are intentionally compact:

```js
localFiles: {
  excerptBytes: 1024,
  readLines: 100,
  readBytes: 4 * 1024,
  grepMatches: 10,
  grepBytes: 3 * 1024
}
```

These limits reduce prompt pressure while preserving enough evidence for targeted
read and grep use.

## Vendored runtime patches

The repository keeps runtime patch scripts rather than relying on manual edits:

- `scripts/bonsai-tool-stop-inline.mjs` contains the self-contained XML stop
  scanner injected into the vendored bundle;
- `scripts/patch-bonsai-runtime.mjs` patches tool-schema injection, control-token
  preservation, raw generated text, chat-template arguments, and early stop.

Patch scripts accept only the expected upstream or already-patched shape. Unknown
upstream drift fails visibly instead of producing a partially patched runtime.

## Caching and model lifecycle

Bonsai GGUF chunks and metadata are stored in browser IndexedDB under its
model-specific cache name. Cache inspection, repair, and deletion use the shared
cache abstraction and do not require loading the model.

Switching conversations may select a different model, but only one model runtime
is active at a time. Reset and disposal follow the same lifecycle used by the
other registered runtimes.

## Diagnostics

Each Bonsai generation reports:

- exact fitted runtime messages;
- active tool schemas;
- bounded output length;
- generation number;
- runtime identifier.

The latest turn's exact requests remain in memory and can be downloaded through
the diagnostic export. After reload, diagnostics are explicitly marked as a
reconstruction rather than an exact runtime capture.

## Verification

Automated coverage includes:

- model registration and 4K context declaration;
- prompt fitting with active schemas;
- canonical history conversion;
- XML parsing for all supported argument types;
- malformed, unknown, and incomplete call rejection;
- thinking-block separation;
- vendored patch idempotence and upstream-drift failure;
- exact prepared-request capture;
- local-file budgets;
- cache inspection and deletion behavior.

Browser smoke testing covers first load, cached reload, ordinary chat, web search,
local read and grep calls, context overflow, stop/abort behavior, model switching,
and exact diagnostic download.
