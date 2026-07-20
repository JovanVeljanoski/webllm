import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dbCleanupOrphanAttachments,
  dbDeleteAttachment,
  dbGetSessionAttachments,
  dbPutAttachment,
} from "../lib/attachment-storage.js";
import { ATTACHMENTS_STORE, DB_NAME, STORE } from "../lib/constants.js";
import { dbDelete, dbPut, openSessionDB } from "../lib/session-storage.js";

describe("attachment storage", () => {
  let db = null;

  beforeEach(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  });

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("upgrades a v1 sessions database additively", async () => {
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await dbPut(legacy, { id: "legacy", messages: [] });
    legacy.close();

    db = await openSessionDB();
    expect(db.objectStoreNames.contains(ATTACHMENTS_STORE)).toBe(true);
  });

  it("stores files by session and isolates conversations", async () => {
    db = await openSessionDB();
    await dbPutAttachment(db, { id: "a1", sessionId: "s1", createdAt: 2 });
    await dbPutAttachment(db, { id: "a2", sessionId: "s1", createdAt: 1 });
    await dbPutAttachment(db, { id: "a3", sessionId: "s2", createdAt: 3 });

    expect((await dbGetSessionAttachments(db, "s1")).map(item => item.id))
      .toEqual(["a2", "a1"]);
    await dbDeleteAttachment(db, "a1");
    expect((await dbGetSessionAttachments(db, "s1")).map(item => item.id))
      .toEqual(["a2"]);
  });

  it("deleting a session cascades to its files", async () => {
    db = await openSessionDB();
    await dbPut(db, { id: "s1", messages: [] });
    await dbPutAttachment(db, { id: "a1", sessionId: "s1" });
    await dbDelete(db, "s1");
    expect(await dbGetSessionAttachments(db, "s1")).toEqual([]);
  });

  it("cleans attachment records whose session no longer exists", async () => {
    db = await openSessionDB();
    await dbPut(db, { id: "kept", messages: [] });
    await dbPutAttachment(db, { id: "a1", sessionId: "kept" });
    await dbPutAttachment(db, { id: "a2", sessionId: "missing" });
    await dbCleanupOrphanAttachments(db);
    expect((await dbGetSessionAttachments(db, "kept")).map(item => item.id))
      .toEqual(["a1"]);
    expect(await dbGetSessionAttachments(db, "missing")).toEqual([]);
  });
});
