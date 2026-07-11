# Web search + agent loop — implementation tracker

Living document: update **Status** and **Notes** as each sub-point is attempted.

Legend: `⬜` not started · `🔄` in progress · `✅` works · `❌` blocked · `⚠️` partial

---

## Phase 0 — Provider + runtime contract (BLOCKING)

### 0.1 Exa MCP search provider (`lib/exa-search.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Keyless search via `POST https://mcp.exa.ai/mcp` → `web_search_exa` |
| **Works** | Node fetch returns results (2026-07-10). SSE + plain JSON parsing. Live smoke: 2 results for "WebGPU news 2026". |
| **Risk** | Browser CORS — preflight from `localhost:8080` should be verified in browser DevTools when testing UI. |
| **Tests** | `tests/exa-search.test.js` (mock fetch) — green |

### 0.2 SearchProvider interface (`lib/search-provider.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Pluggable backend; v1 only Exa |
| **Works** | `formatSearchResultsForModel()` caps total chars |
| **Notes** | Jina Search (`s.jina.ai`) **401 without key** — not v1 default |
| **Tests** | `tests/search-provider.test.js` — green |

### 0.3 Gemma runtime patch (`scripts/patch-gemma-tool-support.mjs` → `gemma-4-e2b.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | `tools` in chat template; `preserveControlTokens`; stop after `<tool_call\|>` |
| **Works** | Patch applied: `_agentTools`, `rawText`, `stopOnToolCall`, `skip_special_tokens` toggle |
| **Does not work** | String-prompt bypass (`generate(string)`) — always uses `encodePrompt(messages)` |
| **Re-apply** | `node scripts/patch-gemma-tool-support.mjs` after bundle updates |
| **Tests** | `tests/gemma-patch.test.js` — green |

### 0.4 Prompt / message shape (`lib/messages.js` agent extensions)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | `reasoning` on assistant + `tool_calls`; tool system guard; agent mode bypasses grammar |
| **Works** | `buildAgentMessages()` appends `TOOL_SYSTEM_GUARD`, preserves `reasoning` / `tool_calls` |
| **Bug fixed** | `splitThinking` regex `/<\|think\|>/` was `/<\|think\|>/` — stripped all `>` chars and mangled tool calls |
| **Tests** | `tests/messages.test.js` — green |

---

## Phase 1 — Agent core (`lib/`)

### 1.1 Tool schema (`lib/tools.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Single `web_search` tool, `additionalProperties: false` |
| **Tests** | `tests/tools.test.js` — green |

### 1.2 Tool output parser (`lib/tool-parser.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Strict `web_search` grammar; optional `call:` prefix; no truncated execution |
| **Works** | Quoted + unquoted query forms; thought-channel guard defers parsing |
| **Tests** | `tests/tool-parser.test.js` — green |

### 1.3 Control-token sanitizer (`lib/sanitize.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Neutralize Gemma control tokens in external search text |
| **Works** | Strips full tokens + orphan closers (`<tool_call\|>`, `<channel\|>`) after partial stripping |
| **Tests** | `tests/sanitize.test.js` — green |

### 1.4 Agent loop (`lib/agent-loop.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Pi inner loop: generate → parse → tool → continue; budgets; abort |
| **Budgets** | `MAX_SEARCH_CALLS=3`, `MAX_MODEL_GENERATIONS=4` |
| **Works** | Search → continue → final answer; abort; search errors; search budget message |
| **Note** | With current budgets, 4th tool request hits search limit (not “agent turn limit” fallthrough) |
| **Tests** | `tests/agent-loop.test.js` — green |

### 1.5 Generate wrapper (`lib/gemma-generate.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | `generateToCompletion()` — stream to end, return `rawText`, respect abort |
| **Tests** | Covered by `tests/agent-loop.test.js` |

---

## Phase 2 — App integration + UI

### 2.1 Model gate (`lib/models.js`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | `supportsTools: true` on Gemma 4 only |
| **Works** | LFM2 models have no `supportsTools`; toggle disabled when not Gemma |
| **Tests** | `tests/models.test.js` — green |

### 2.2 Preferences + toggle (`lib/prefs.js`, `index.html`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | `webSearchPreferred`; effective only when Gemma loaded |
| **Mutual exclusion** | Grammar mode buttons disabled when web search on; enabling search forces grammar off |
| **Tests** | `tests/prefs.test.js` — green |

### 2.3 `sendMessage()` agent branch (`index.html`)

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Route to `runAgentTurn` when `webSearchEffective()` |
| **Works** | Uses `buildAgentMessages`, `WEB_SEARCH_TOOLS`, `defaultSearchProvider`, phase status updates |

### 2.4 Tool activity UI

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Status line during search; minimal `toolTrace` on assistant message |
| **Works** | `Searching: {query}` in model status; `.tool-trace` footer on assistant cards |
| **Deferred** | Full curator / pi-style UI |

### 2.5 Privacy disclosure

| | |
|---|---|
| **Status** | ✅ |
| **Goal** | Copy when toggle on: data sent to Exa for search |
| **Works** | `#web-search-hint` text mentions Exa MCP third-party |

---

## Phase 3 — Polish (post-MVP)

| Sub-point | Status | Notes |
|-----------|--------|-------|
| KV cache reuse measurement | ⬜ | TTFT across iterations unknown |
| BYOK providers | ⬜ | Jina/Exa API keys |
| `/search` force override | ⬜ | Reviewer suggestion |
| Upstream runtime PR | ⬜ | Replace patch script long-term |
| Browser CORS verification | ✅ | `access-control-allow-origin: *` on Exa MCP preflight (2026-07-10) |

---

## Verification checklist (feature “done”)

- [x] `npm test` green (95 tests)
- [x] `npm run lint` green
- [x] Patched runtime markers present (`tests/gemma-patch.test.js`)
- [x] Exa MCP live search from Node
- [ ] End-to-end in browser: Gemma 4 + toggle → model emits tool call → search → answer *(requires manual test with GPU + model load)*
- [x] Agent loop unit tests: search → answer, abort, budgets, errors
- [x] Grammar + web search mutual exclusion in UI logic

---

## Known issues / follow-ups

1. **`splitThinking` regex** — fixed; was corrupting any text containing `>` (including tool calls).
2. **Search limit vs agent limit** — with `MAX_SEARCH_CALLS=3` and `MAX_MODEL_GENERATIONS=4`, persistent tool-calling hits search limit on the 4th generation; “Agent turn limit reached” fallthrough is defensive only.
3. **Model must cooperate** — Gemma 4 must emit valid `<\|tool_call>…<tool_call\|>` syntax; quality depends on weights + tools in prompt.

---

*Last updated: 2026-07-10 — Phases 0–2 implemented; tests green.*
