# Web search agent loop — expert brief

Use this document when asking for external help on remaining reliability issues with Gemma 4 E2B tool calling + Exa MCP in WebLLM.

**Decision (2026-07-10):** We are still iterating in-repo first; this brief captures context if a Gemma/function-calling or WebGPU runtime expert is needed.

---

## What we're building

Browser-only chat app ([WebLLM](https://github.com/jovanveljanoski/webllm)) with optional **web search** on **Gemma 4 E2B** (~2.5 GB, WebGPU):

1. User enables **Web search** toggle (sidebar)
2. `runAgentTurn()` inner loop: generate → parse tool call → Exa MCP search → generate again → answer
3. Search provider: **Exa MCP** (`POST https://mcp.exa.ai/mcp`, no API key, CORS `*`)

Spec: [`web-llm-tool-call-web-search.md`](../web-llm-tool-call-web-search.md)  
Tracker: [`implementation-tracker.md`](implementation-tracker.md)

---

## Expert review (2026-07-10) — incorporated

| Recommendation | Action taken |
|----------------|--------------|
| Keep `model.reset()` for correctness | ✅ Reset at turn start + before each continuation gen |
| Extend stopping to bare calls with brace-aware detector | ✅ `lib/tool-call-detector.js` + stop in `lib/gemma-generate.js` |
| Do not assume E2B success rate | 📋 Benchmark TBD; add `?debugAgent=1` diagnostics |
| A/B test `enableThinking` | ✅ `?agentThinking=0\|1` (default: runtime template default) |
| Minimal upstream PR shape | 📋 Documented below; patch script remains interim |
| Capture failing-turn diagnostics | ✅ `lib/agent-debug.js` → `window.__lastAgentDebug` |

### Diagnostics

Enable with **`?debugAgent=1`** or `localStorage.webllm_debug_agent = "1"`.

After each agent turn, inspect **`window.__lastAgentDebug`** in DevTools console. Snapshot includes:

- `branch` — which return path fired (`final_answer`, `execute_search`, `duplicate_query_synthesize`, …)
- `rawTextTail`, `parserToolCalls`, `collectedToolCalls`, `hasCompleteDetector`
- `primary`, `searchCalls`, `cacheReset`, `finishReason` (`tool_call` \| `abort` \| null)

A/B thinking: **`?agentThinking=0`** vs **`?agentThinking=1`**.

### Upstream PR target (minimal)

1. Remove hardcoded `tools: null` in `encodePrompt`
2. Pass tools + `enable_thinking` through unchanged
3. Expose unstripped decode (`rawText`) or structured token events
4. Configurable tool-call stopping (or document that callers stop externally)
5. Document cache lifecycle — when prefix reuse is valid vs requires reset
6. Fixture tests: wrapped, bare, `<turn|>`-terminated, thinking+call, braces-in-query

---

## Architecture (relevant files)

| Layer | File | Role |
|-------|------|------|
| UI | `index.html` | Toggle, `sendMessage()` → `runAgentTurn` when `webSearchEffective()` |
| Agent loop | `lib/agent-loop.js` | Budgets, KV reset, search, continuation, debug branches |
| Parser | `lib/tool-parser.js` | Gemma 4 tool-call syntax (vLLM-inspired tiers) |
| Detector | `lib/tool-call-detector.js` | Brace-aware complete-call detection + stream stop |
| Debug | `lib/agent-debug.js` | `?debugAgent=1` turn snapshots |
| Generate | `lib/gemma-generate.js` | Stream to completion, tool-call stop |
| Search | `lib/exa-search.js` | Exa MCP client |
| Messages | `lib/messages.js` | `buildAgentMessages()`, replays `agentTranscript` |
| Runtime patch | `scripts/patch-gemma-tool-support.mjs` → `gemma-4-e2b.js` | Pass `tools`, `preserveControlTokens`, `stopOnToolCall`, `rawText` |

### Runtime patch (required)

Unpatched `gemma-4-e2b.js` hardcodes `tools: null` and strips special tokens on decode. Re-apply after bundle updates:

```bash
make patch-gemma
```

---

## Expected model output format

From Google Gemma 4 function-calling docs and E2B tokenizer `response_schema`:

```
<|tool_call>call:web_search{query:<|"|>latest NBA trades<|"|>}<tool_call|>
```

**Observed E2B 2B QAT variations** (must all be handled):

| Format | Example |
|--------|---------|
| Standard | `<\|tool_call>call:web_search{query:<\|"\|>…<\|"\|>}<tool_call\|>` |
| No wrapper | `call:web_search{query:latest NBA trades}` |
| End with turn | `…}<turn\|>` instead of `<tool_call\|>` |
| Thinking + call | `<\|channel>thought\n…\n<channel\|>\ncall:web_search{…}` |

---

## Known failure modes (observed)

### A. Search runs but answer is raw tool syntax

**Symptom:** Footer shows `Search: "…" — ok (N results)` but bubble text is `call:web_search{…}`.

**Cause (fixed):** KV cache not reset between loop iterations; second generation corrupted.

**Fix:** `model.reset()` before continuation gens + at start of each `runAgentTurn`.

### B. Loop stops with tool syntax, no search trace

**Symptom:** Bubble shows `call:web_search{…}` (and maybe long thinking), **no** “Search: …” footer.

**Cause:** Agent loop returned before calling Exa — parser missed call in some raw shapes, or `userWantsWebSearch()` was too narrow (e.g. “latest NBA trades” without “search” or `?`).

**Fixes applied:**

- `collectWebSearchCalls()` scans raw + thinking + content
- Forced search when user message matches freshness/news/sports patterns
- Rescue path when visible output is tool-call-only text
- `lastResortPrimary()` before every final-answer return
- Brace-aware stop in `gemma-generate.js` (not regex-only)

### C. Follow-up (“and?”) repeats tool call

**Cause:** Tool turn not in session history for prompt rebuild.

**Fix:** Persist `agentTranscript` (assistant+tool_calls, tool) on assistant message; `buildAgentMessages()` replays it.

---

## Agent loop budgets

```javascript
MAX_SEARCH_CALLS = 3
MAX_MODEL_GENERATIONS = 4
```

Duplicate identical query after a successful search → synthesize from cached tool results instead of re-searching.

---

## What we need expert help on (if still flaky)

1. **KV cache semantics** — token-ID prefix validation vs full reset (expert agrees reset is correct for now).
2. **E2B 2B QAT benchmarks** — valid-call / malformed-call rates on our exact revision.
3. ~~**Bare stop detection**~~ — addressed in app layer via `tool-call-detector.js`.
4. **`enable_thinking` A/B** — use `?agentThinking=0|1` and share `__lastAgentDebug` snapshots.
5. **Upstream patch** — see table above.

---

## Reproduction

```bash
make run   # http://localhost:8080?debugAgent=1
```

1. Hard refresh: **⌥ + View → Reload Page From Origin** (Safari)
2. Load **Gemma 4 E2B**
3. Enable **Web search**
4. New conversation
5. Ask: *“tell me the latest NBA trades”*

**Expected:** Search footer + synthesized answer (not raw `call:web_search{…}`).

**Problem case (screenshot 2026-07-10):** Thinking block + `call:web_search{query:latest NBA trades}` only, 230 tok, no search footer.

---

## Tests

```bash
npm test   # includes agent-loop, tool-parser, search-intent tests
```

Key tests: `tests/agent-loop.test.js`, `tests/tool-parser.test.js`, `tests/exa-search.test.js`

---

## Contact / repo state

- Implementation in progress on main webllm repo `research-e4b/` is separate (E4B research); **production path uses `gemma-4-e2b.js` (E2B weights)**.
- Expert feedback welcome on parser tiers vs vLLM `gemma4_utils.py` and Google reference implementation.
