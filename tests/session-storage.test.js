import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openSessionDB, dbGetAll, dbPut, dbDelete } from "../lib/session-storage.js";
import { DB_NAME } from "../lib/constants.js";

describe("session-storage", () => {
  /** @type {IDBDatabase | null} */
  let db = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  beforeEach(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  it("opens database and persists sessions", async () => {
    db = await openSessionDB();
    const session = {
      id: "s1",
      title: "Test",
      systemPrompt: "",
      messages: [],
      modelId: "gemma4",
      createdAt: 1,
      updatedAt: 2,
    };
    await dbPut(db, session);
    const all = await dbGetAll(db);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Test");
  });

  it("deletes sessions by id", async () => {
    db = await openSessionDB();
    const session = {
      id: "s2",
      title: "Delete me",
      systemPrompt: "",
      messages: [],
      modelId: "lfm2",
      createdAt: 1,
      updatedAt: 2,
    };
    await dbPut(db, session);
    await dbDelete(db, "s2");
    expect(await dbGetAll(db)).toEqual([]);
  });
});
