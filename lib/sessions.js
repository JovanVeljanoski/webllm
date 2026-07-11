/** @file Session list helpers and session record factories. */

import { DEFAULT_MODEL_ID } from "./constants.js";
import { isValidModelId } from "./models.js";

export function sessionDateGroup(ts, now = new Date()) {
  const d = new Date(ts);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday.getTime() - 86400000);
  const startWeek = new Date(startToday.getTime() - 6 * 86400000);
  if (d >= startToday) return "Today";
  if (d >= startYesterday) return "Yesterday";
  if (d >= startWeek) return "Previous 7 days";
  return "Older";
}

export function filterSessions(sessions, query = "") {
  const q = query.trim().toLowerCase();
  return sessions.filter(s => !q || s.title.toLowerCase().includes(q));
}

export function sortSessionsByUpdatedAt(sessions) {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function upsertSessionInList(sessions, session) {
  const next = [...sessions];
  const idx = next.findIndex(s => s.id === session.id);
  if (idx >= 0) next[idx] = session;
  else next.unshift(session);
  return sortSessionsByUpdatedAt(next);
}

export function createSessionRecord({
  id,
  title = "New chat",
  modelId,
  selectedModelId,
  now = Date.now(),
  models,
}) {
  const resolvedModelId = isValidModelId(modelId, models)
    ? modelId
    : (isValidModelId(selectedModelId, models) ? selectedModelId : DEFAULT_MODEL_ID);
  return {
    id,
    title,
    systemPrompt: "",
    messages: [],
    modelId: resolvedModelId,
    createdAt: now,
    updatedAt: now,
  };
}

export function firstMessageTitle(text, maxLen = 50) {
  return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");
}

export function normalizeSessionTitle(title) {
  return (title || "").trim() || "Untitled";
}

export function canSendToModel({ text, busy, model, loadedModelId, expectedModelId }) {
  if (!text?.trim() || !model || busy) return { ok: false, reason: "busy_or_empty" };
  if (loadedModelId !== expectedModelId) {
    return { ok: false, reason: "model_mismatch" };
  }
  return { ok: true };
}

/** @param {object} session @param {number} messageIndex */
export function truncateSessionMessagesAfterIndex(session, messageIndex) {
  if (!session?.messages?.length) return session;
  const idx = Math.max(0, Math.min(messageIndex, session.messages.length - 1));
  return { ...session, messages: session.messages.slice(0, idx + 1) };
}

/** @param {object} session @param {number} messageIndex @param {string} content */
export function updateUserMessageAtIndex(session, messageIndex, content) {
  const trimmed = (content || "").trim();
  if (!trimmed) return null;
  const messages = [...session.messages];
  const msg = messages[messageIndex];
  if (!msg || msg.role !== "user") return null;
  messages[messageIndex] = { ...msg, content: trimmed };
  const next = { ...session, messages };
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (messageIndex === firstUserIdx) {
    next.title = firstMessageTitle(trimmed);
  }
  return next;
}

/** @param {object} session */
export function lastUserMessageContent(session) {
  const messages = session?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content || "";
  }
  return "";
}

/** @param {object} session @param {number} messageIndex */
export function canRegenerateFromUserMessage(session, messageIndex) {
  const msg = session?.messages?.[messageIndex];
  return !!msg && msg.role === "user";
}

export const SESSION_GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

export function groupSessionsByDate(sessions, now = new Date()) {
  const groups = new Map();
  for (const s of sessions) {
    const g = sessionDateGroup(s.updatedAt, now);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  return groups;
}
