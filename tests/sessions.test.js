import { describe, expect, it } from "vitest";
import {
  canRegenerateFromUserMessage,
  canSendToModel,
  createSessionRecord,
  filterSessions,
  firstMessageTitle,
  lastUserMessageContent,
  normalizeSessionTitle,
  normalizeSessionRecord,
  sortSessionsByUpdatedAt,
  truncateSessionMessagesAfterIndex,
  updateUserMessageAtIndex,
  upsertSessionInList,
} from "../lib/sessions.js";
import { MODELS } from "../lib/models.js";
import { DEFAULT_SYSTEM_PROMPT } from "../lib/constants.js";

describe("session records", () => {
  it("creates a session with resolved model id", () => {
    const session = createSessionRecord({
      id: "s1",
      title: "Test",
      selectedModelId: "lfm2",
      now: 1000,
      models: MODELS,
    });
    expect(session.modelId).toBe("lfm2");
    expect(session.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(session.messages).toEqual([]);
  });

  it("inherits explicit model and web search settings", () => {
    const session = createSessionRecord({
      id: "s2",
      title: "Test",
      modelId: "lfm2",
      webSearchPreferred: true,
      models: MODELS,
    });
    expect(session.modelId).toBe("lfm2");
    expect(session.webSearchPreferred).toBe(true);
  });

  it("normalizes titles and first message titles", () => {
    expect(normalizeSessionTitle("  ")).toBe("Untitled");
    expect(firstMessageTitle("a".repeat(60))).toBe(`${"a".repeat(50)}…`);
  });
});

describe("session list helpers", () => {
  const sessions = [
    { id: "a", title: "Alpha chat", updatedAt: 200 },
    { id: "b", title: "Beta", updatedAt: 300 },
    { id: "c", title: "Gamma", updatedAt: 100 },
  ];

  it("sorts and filters sessions", () => {
    expect(sortSessionsByUpdatedAt(sessions).map(s => s.id)).toEqual(["b", "a", "c"]);
    expect(filterSessions(sessions, "alpha").map(s => s.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "zzz")).toEqual([]);
    expect(filterSessions([{ id: "legacy" }], "legacy")).toEqual([]);
  });

  it("upserts and re-sorts sessions", () => {
    const updated = upsertSessionInList(sessions, { id: "a", title: "Alpha chat", updatedAt: 999 });
    expect(updated[0].id).toBe("a");
    expect(updated[0].updatedAt).toBe(999);
  });

  it("normalizes legacy records before rendering", () => {
    const normalized = normalizeSessionRecord({
      id: 7,
      title: undefined,
      messages: [
        { role: "user", content: 42 },
        { role: "assistant", content: "old answer", agentTranscript: [{ role: "tool" }] },
        { role: "tool", content: "old result" },
      ],
      updatedAt: "2026-07-10T12:00:00Z",
    }, MODELS);
    expect(normalized).toMatchObject({
      id: "7",
      title: "Untitled",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      modelId: "gemma4",
      messages: [{ role: "user", content: "42" }, { role: "assistant", content: "old answer" }],
    });
    expect(normalized.messages[1]).not.toHaveProperty("agentTranscript");
    expect(Number.isFinite(normalized.createdAt)).toBe(true);
    expect(normalized).not.toHaveProperty("webSearchPreferred");
  });

  it("preserves per-session web search preference", () => {
    const normalized = normalizeSessionRecord({
      id: "tools",
      webSearchPreferred: true,
      messages: [],
    }, MODELS);
    expect(normalized.webSearchPreferred).toBe(true);
  });

  it("migrates embedded agent state to one chronological transcript", () => {
    const normalized = normalizeSessionRecord({
      id: "legacy-agent",
      messages: [
        { role: "user", content: "Who won?" },
        {
          role: "assistant",
          content: "Brazil won.",
          thinking: "all thoughts",
          agentSteps: [
            { type: "thinking", thinking: "Search first." },
            { type: "tool_call", query: "scores" },
            { type: "tool_result", query: "scores", resultCount: 2, status: "ok" },
            { type: "thinking", thinking: "Use the result." },
            { type: "answer", content: "Brazil won." },
          ],
          toolTranscript: [
            {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "c1",
                type: "function",
                function: { name: "web_search", arguments: { queries: ["scores"] } },
              }],
            },
            { role: "tool", tool_call_id: "c1", content: "results" },
          ],
          toolTrace: [{ query: "scores", provider: "exa-mcp" }],
        },
      ],
    }, MODELS);

    expect(normalized.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(normalized.messages[1].thinking).toBe("Search first.");
    expect(normalized.messages[2]).toMatchObject({
      tool_call_id: normalized.messages[1].tool_calls[0].id,
      content: "results",
      meta: { query: "scores", resultCount: 2, provider: "exa-mcp" },
    });
    expect(normalized.messages[3]).toMatchObject({
      content: "Brazil won.",
      thinking: "Use the result.",
    });
  });

  it("repairs duplicate canonical tool-call IDs with matching results", () => {
    const makeCall = () => ({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "duplicate",
        type: "function",
        function: { name: "web_search", arguments: { query: "x" } },
      }],
    });
    const normalized = normalizeSessionRecord({
      id: "duplicates",
      messages: [
        makeCall(),
        { role: "tool", tool_call_id: "duplicate", content: "one" },
        makeCall(),
        { role: "tool", tool_call_id: "duplicate", content: "two" },
      ],
    }, MODELS);
    const calls = normalized.messages.filter(message => message.role === "assistant");
    const results = normalized.messages.filter(message => message.role === "tool");
    expect(calls[0].tool_calls[0].id).not.toBe(calls[1].tool_calls[0].id);
    expect(results.map(message => message.tool_call_id)).toEqual([
      calls[0].tool_calls[0].id,
      calls[1].tool_calls[0].id,
    ]);
  });
});

describe("canSendToModel", () => {
  it("allows send when text, model, and ids align", () => {
    expect(canSendToModel({
      text: "hi",
      model: {},
      busy: false,
      loadedModelId: "gemma4",
      expectedModelId: "gemma4",
    })).toEqual({ ok: true });
  });

  it("blocks empty, busy, and missing model states", () => {
    expect(canSendToModel({ text: "", model: {}, busy: false, loadedModelId: "a", expectedModelId: "a" }))
      .toEqual({ ok: false, reason: "busy_or_empty" });

    expect(canSendToModel({
      text: "hi",
      model: null,
      busy: false,
      loadedModelId: "a",
      expectedModelId: "a",
    })).toEqual({ ok: false, reason: "busy_or_empty" });

    expect(canSendToModel({
      text: "hi",
      model: {},
      busy: true,
      loadedModelId: "a",
      expectedModelId: "a",
    })).toEqual({ ok: false, reason: "busy_or_empty" });
  });

  it("blocks when the loaded model does not match the session", () => {
    expect(canSendToModel({
      text: "hi",
      model: {},
      busy: false,
      loadedModelId: "lfm2",
      expectedModelId: "gemma4",
    })).toEqual({ ok: false, reason: "model_mismatch" });
  });
});

describe("message branch helpers", () => {
  const session = {
    title: "First question",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Follow up" },
      { role: "assistant", content: "Sure" },
    ],
  };

  it("truncates messages after a user turn", () => {
    const next = truncateSessionMessagesAfterIndex(session, 0);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("Hello");
  });

  it("updates a user message and retitles when it is the first user turn", () => {
    const next = updateUserMessageAtIndex(session, 0, "Updated hello");
    expect(next?.messages[0].content).toBe("Updated hello");
    expect(next?.title).toBe("Updated hello");
  });

  it("finds the latest user message and validates regenerate targets", () => {
    expect(lastUserMessageContent(session)).toBe("Follow up");
    expect(canRegenerateFromUserMessage(session, 2)).toBe(true);
    expect(canRegenerateFromUserMessage(session, 1)).toBe(false);
  });
});
