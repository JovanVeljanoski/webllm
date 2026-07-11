import { describe, expect, it } from "vitest";
import {
  SESSION_GROUP_ORDER,
  canRegenerateFromUserMessage,
  canSendToModel,
  createSessionRecord,
  filterSessions,
  firstMessageTitle,
  groupSessionsByDate,
  lastUserMessageContent,
  normalizeSessionTitle,
  sortSessionsByUpdatedAt,
  truncateSessionMessagesAfterIndex,
  updateUserMessageAtIndex,
  upsertSessionInList,
} from "../lib/sessions.js";
import { MODELS } from "../lib/models.js";

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
    expect(session.messages).toEqual([]);
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
  });

  it("upserts and re-sorts sessions", () => {
    const updated = upsertSessionInList(sessions, { id: "a", title: "Alpha chat", updatedAt: 999 });
    expect(updated[0].id).toBe("a");
    expect(updated[0].updatedAt).toBe(999);
  });

  it("groups sessions by relative date buckets", () => {
    const now = new Date("2026-07-10T12:00:00");
    const groups = groupSessionsByDate([
      { updatedAt: now.getTime() },
      { updatedAt: now.getTime() - 86400000 },
      { updatedAt: now.getTime() - 8 * 86400000 },
    ], now);
    expect(SESSION_GROUP_ORDER.every(label => typeof label === "string")).toBe(true);
    expect(groups.get("Today")).toHaveLength(1);
    expect(groups.get("Yesterday")).toHaveLength(1);
    expect(groups.get("Older")).toHaveLength(1);
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
