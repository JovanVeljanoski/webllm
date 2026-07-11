# pi.dev agent harness — investigation notes

**Purpose:** Understand how pi.dev makes a model behave like an agent (loop, continuation, transcript), independent of coding tools (grep, write, bash). Use this as the reference for WebLLM’s custom agent loop before implementation.

**Sources (2026-07-10):**

- [`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)
- [`packages/agent/src/agent.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts)
- [`packages/agent/src/harness/agent-harness.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts)
- [`packages/agent/README.md`](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)
- [`packages/agent/src/harness/messages.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/messages.ts)

---

## 1. Architecture — three layers

Pi separates **transport**, **loop**, and **product harness**:

| Layer | Package / module | Responsibility |
|-------|------------------|----------------|
| **LLM transport** | `@earendil-works/pi-ai` | HTTP streaming to cloud providers; yields structured events (`text_delta`, `toolcall_start`, …); native tool-call blocks for OpenAI/Anthropic-style APIs |
| **Agent loop** | `@earendil-works/pi-agent-core` (`agent-loop.ts`, `Agent` class) | Stateful transcript, multi-turn generate→tool→generate loop, events, abort, steering/follow-up queues |
| **Product harness** | `AgentHarness` in `packages/agent/src/harness/` | Sessions, compaction, skills, prompt templates, hooks, persistence — used by `pi-coding-agent` CLI/TUI |

**Key insight:** “Agentic behavior” lives mostly in **agent-loop.ts** (~790 lines). The harness adds session management and context engineering on top. WebLLM only needs the loop layer (+ minimal events), not the full harness.

---

## 2. What makes a model “agentic” in pi

It is **not** a different model mode. It is a **control loop** around ordinary chat completion:

1. Send the model a **system prompt**, **full transcript**, and **tool schemas**.
2. Stream one **assistant** message.
3. If the assistant message contains **tool calls** → execute tools → append **tool result** messages to transcript.
4. **Continue** (same transcript, no new user message) → go to step 2.
5. Stop when the assistant message has **no tool calls** (natural answer) or a **budget/hook** says stop.

The model “acts like an agent” because it repeatedly sees its own prior tool calls and their outcomes in context, and the runtime keeps calling it until it produces a final user-facing answer.

---

## 3. Core loop algorithm (`runLoop`)

Pi uses **two nested loops** in `agent-loop.ts`:

```
OUTER LOOP (follow-up queue)
  while true:
    INNER LOOP (tool calls + steering)
      while hasMoreToolCalls OR pendingSteeringMessages:
        turn_start
        inject pending user/steering messages
        streamAssistantResponse()     → one LLM call
        if stopReason error/aborted → agent_end, return
        extract toolCalls from assistant content
        if toolCalls:
          execute tools → append toolResult messages
          hasMoreToolCalls = !allToolsReturnedTerminate
        else:
          hasMoreToolCalls = false
        turn_end
        optional prepareNextTurn()    → refresh context/model
        optional shouldStopAfterTurn()
        poll steering queue
    poll follow-up queue
    if follow-ups → pending = follow-ups; continue outer
    else break
  agent_end
```

### 3.1 Inner loop = one “agent turn”

Each **turn** is exactly:

- **One** LLM generation (`streamAssistantResponse`)
- **Zero or more** tool executions
- Tool results appended **before** the next turn

This matches our planned `runAgentTurn`: iterate until no tool calls or cap hit.

### 3.2 Outer loop = follow-up messages

After the inner loop would stop (no more tool calls, no steering), pi checks a **follow-up queue**. Messages queued via `agent.followUp()` start a new inner loop without the user sending a new prompt in the UI.

WebLLM v1: **skip** — we only need inner loop per user send.

### 3.3 Continuation without new user input

Two APIs:

| API | When | Adds user message? |
|-----|------|-------------------|
| `agent.prompt("…")` | New user intent | Yes |
| `agent.continue()` | Retry / resume | No — last message must be `user` or `toolResult` |

`agentLoopContinue()` re-enters `runLoop` with existing context. Used after errors or when transcript ends with tool results waiting for synthesis.

**WebLLM equivalent:** each tool iteration is implicitly `continue()` — we rebuild `messages[]` with assistant + tool rows and call `generate()` again without a new user message.

---

## 4. Per-turn LLM call boundary

Before every generation, pi transforms context:

```
AgentMessage[] 
  → transformContext()   (optional: prune, inject, compaction)
  → convertToLlm()       (filter UI-only roles, map custom types)
  → Message[] + tools + systemPrompt
  → streamFn(model, context, options)
```

Important design choice: **AgentMessage[] is the source of truth**; conversion to provider format happens **only at the LLM boundary**. Custom message types (bash execution logs, compaction summaries) are stored in the agent transcript but converted to synthetic `user` text for the provider.

**WebLLM mapping:**

- `session.messages` = persisted user/assistant chat (UI)
- Ephemeral agent turn state = assistant `tool_calls` + `tool` result rows (may be minimal metadata in v1)
- `buildMessages()` = our `convertToLlm` + Jinja chat template (must include `tools`, `tool_calls`, `reasoning`)

---

## 5. Streaming and assistant message lifecycle

During one generation:

1. `message_start` — assistant message begins (may be empty partial)
2. `message_update` — deltas (`text_delta`, `thinking_delta`, `toolcall_delta`, …)
3. `message_end` — final assistant message committed to `context.messages`

Tool execution starts **only after** `message_end` (assistant message is complete). Pi treats `message_end` as a **barrier** before tool preflight.

**WebLLM mapping:**

- Stream tokens to UI during each generation pass (existing `sendMessage` pattern)
- Parse tool calls from **complete** raw output (or incrementally with care — v1: parse after stream completes)
- Do not fire search until generation finishes and parser confirms a valid call

---

## 6. Tool execution semantics (agentic, not tool-specific)

When assistant content includes `toolCall` blocks:

1. **Truncation guard:** if `stopReason === "length"`, **fail all tool calls** with error results (do not execute partial JSON args).
2. **Preflight:** validate args against schema; `beforeToolCall` hook can block.
3. **Execute:** sequential or parallel batch; tools may stream partial results via `tool_execution_update`.
4. **Postprocess:** `afterToolCall` hook; tools may return `terminate: true`.
5. **Append** `toolResult` messages to transcript (in assistant source order).
6. **Inner loop continues** unless every tool in batch set `terminate: true`.

Errors: tools **throw**; agent catches and sends `isError: true` tool results to the model (so it can recover).

**WebLLM v1 should adopt:**

- Fail closed on truncated tool calls (aligns with reviewer feedback)
- Sequential execution for single `web_search` tool
- Abort → tool error must not run; abort → cancel in-flight fetch
- Structured error strings back to model in tool result channel

**WebLLM v1 can defer:**

- Parallel tool execution
- `beforeToolCall` / `afterToolCall` hooks (inline checks OK)
- `terminate: true` batch semantics

---

## 7. Event model (UI contract)

Pi exposes a stable event stream for TUIs:

| Event | Use |
|-------|-----|
| `agent_start` / `agent_end` | Disable input, show spinner |
| `turn_start` / `turn_end` | Per-generation boundary |
| `message_start` / `message_update` / `message_end` | Chat rendering |
| `tool_execution_start` / `_update` / `_end` | “Searching…” status |

**WebLLM mapping:** map to existing UI phases:

- `phase: "generate"` → streaming assistant text/thinking
- `phase: "tool_start"` / `"tool_end"` → sidebar status / disclosure
- One visible assistant bubble per user send (tool trace as metadata or collapsible)

---

## 8. Steering and follow-up (advanced agent UX)

| Mechanism | Behavior |
|-----------|----------|
| **Steering** (`agent.steer()`) | Queue user messages injected **after current turn** (e.g. user types while tool runs) |
| **Follow-up** (`agent.followUp()`) | Queue messages run **after agent would otherwise stop** |

Both use `one-at-a-time` or `all` drain modes.

**WebLLM v1:** not required. Existing **Stop** button maps to `abort()`. Steering would need queue + inject mid-loop — future work.

---

## 9. AgentHarness — what pi-coding-agent adds

`AgentHarness` wraps `runAgentLoop` with product features:

- **Session persistence** — append messages to JSONL session files on `message_end`
- **Hooks** — `before_agent_start`, `context`, `tool_call`, `tool_result`
- **prepareNextTurn** — refresh model/tools/system prompt each turn; flush pending writes
- **Compaction** — summarize old context when token budget exceeded
- **Skills / prompt templates** — inject specialized instructions as user messages
- **Branch summarization** — tree-structured session navigation

These improve **long-horizon coding agents**, not the minimal search loop.

**WebLLM v1:** skip compaction, skills, session tree. Optional: system prompt tweak for tool use; minimal `toolTrace` on assistant message.

---

## 10. pi-ai vs WebLLM — structural difference

| Aspect | pi (cloud APIs) | WebLLM (Gemma 4 E2B) |
|--------|-----------------|----------------------|
| Tool calls | Native structured blocks in API stream | Text tokens: `<\|tool_call>call:…{…}<tool_call\|>` |
| Tool results | `toolResult` role in provider API | Chat template: `<\|tool_response>…<tool_response\|>` |
| Loop driver | Same `runLoop` logic | Same logic, different parse/render |
| Transport | `streamFn` → HTTP | `Gemma4Mobile.generate()` → WebGPU |
| Context window | Large (100k+) | Small (~8k effective for 2B demo) |
| Multi-iteration cost | API $ + latency | Local GPU; 2–4× generate passes per user send |

**The agent loop is portable; the token format is not.** WebLLM’s blocker is runtime/template support, not loop design.

---

## 11. WebLLM today vs target

### Today (`index.html` → `sendMessage`)

```
user message → buildMessages(session) → generate() once → splitThinking → persist assistant
```

Single pass. No tools in template. No continuation.

### Target (aligned with pi inner loop)

```
user message → runAgentTurn:
  loop (max N searches + 1 synthesis):
    buildMessages(session + ephemeral tool turns, tools=[web_search])
    generate() → stream UI
    parse tool calls from raw output
    if none → final answer, break
    execute web_search → append assistant(tool_calls) + tool(result) to ephemeral transcript
  persist one assistant message (+ optional toolTrace)
```

This **is** pi’s inner loop, adapted for Gemma text tool syntax.

---

## 12. Recommended WebLLM agent module shape

Mirror pi’s separation without npm dependency:

| Module | pi equivalent | Responsibility |
|--------|---------------|----------------|
| `lib/agent-loop.js` | `runLoop` + tool execution | Iteration, budgets, abort, phases |
| `lib/agent-events.js` (optional) | Event emitters | Thin wrapper for UI callbacks |
| `lib/tool-parser.js` | pi-ai toolcall parsing | Gemma text → `{ name, arguments }` |
| `lib/messages.js` | `convertToLlm` + harness messages | `buildMessages` with tools, reasoning, tool rows |
| `index.html` | TUI subscriber | Subscribe to phases; single `sendMessage` branch |

### Budgets (from reconciled spec)

- `MAX_SEARCH_CALLS = 3`
- `MAX_MODEL_GENERATIONS = MAX_SEARCH_CALLS + 1` (ensure synthesis pass)

### Continuation rule

After each tool result, next `generate()` must see:

- Full user/assistant history
- Current turn’s assistant message **with** `tool_calls` and **`reasoning` retained** (Gemma 4 template requirement)
- Tool result message in template-compatible form

---

## 13. What we cannot replicate easily (v1)

| pi feature | Why hard in WebLLM |
|------------|-------------------|
| Native `toolcall_delta` streaming | Gemma emits tool syntax as text; parse after complete |
| Compaction / branch summary | No token counter integration; small context anyway |
| Steering / follow-up queues | No mid-run message injection UX |
| `streamFn` swap for many providers | Single local WebGPU runtime |
| Parallel tool batch | One search tool; sequential is fine |
| Provider prompt caching (`sessionId`) | KV prefix cache maybe; unverified |

None of these block a ** useful v1 web-search agent**.

---

## 14. Can we achieve something similar?

**Yes — for the core agentic pattern (decide → act → observe → answer).**

| Capability | Achievable? | Notes |
|------------|-------------|-------|
| Multi-step tool loop | ✅ | Same algorithm as pi inner loop |
| Streamed assistant UX per pass | ✅ | Reuse existing generator streaming |
| Tool result fed back into model | ✅ | Requires runtime `tools` + template support |
| Reliable tool-call parsing | ⚠️ | 2B QAT; strict parser + system prompt tuning (~85% target) |
| Reasoning preserved across tool steps | ⚠️ | Must not strip `reasoning` between iterations |
| KV cache across iterations | ❓ | Measure TTFT; may recompute prefix |
| pi-level session/compaction | ❌ v1 | Not needed for search demo |
| pi-level steering | ❌ v1 | Stop button sufficient |

**Verdict:** WebLLM can implement the **same agent control flow** as pi’s `agent-loop.ts` for a single tool. It will feel like a lighter agent: one user message may trigger 2–4 local generations and 1–3 searches, then one consolidated reply. That matches pi’s semantics with narrower scope and Gemma-specific encoding.

**Prerequisite unchanged:** Phase 0 runtime contract (tools in prompt, tool-aware stop/decode, reasoning retention) must pass before UI work.

---

## 15. Implementation checklist (post-approval)

1. Runtime: `tools` in `encodePrompt`, dual decode path, stop at `<tool_call|>` when appropriate
2. `lib/tool-parser.js` + tests
3. `lib/agent-loop.js` — pi inner loop semantics, budgets, abort
4. `lib/exa-search.js` (or provider interface) — tool executor only
5. Extend `buildMessages()` for tool turns + system prompt guard
6. `sendMessage()` branch: `webSearchEnabled && gemma4` → `runAgentTurn`
7. UI: toggle, tool activity indicator, disclosure

---

*End of notes.*
