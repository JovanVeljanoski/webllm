/** @file Chat session and attachment IndexedDB access. */

import {
  ATTACHMENTS_SESSION_INDEX,
  ATTACHMENTS_STORE,
  DB_NAME,
  DB_VERSION,
  STORE,
} from "./constants.js";

export function openSessionDB(idb = globalThis.indexedDB) {
  if (!idb) return Promise.reject(new Error("IndexedDB is unavailable"));
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onblocked = () => reject(new Error("Session database is blocked by another tab"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) {
        const attachments = db.createObjectStore(ATTACHMENTS_STORE, { keyPath: "id" });
        attachments.createIndex(ATTACHMENTS_SESSION_INDEX, ATTACHMENTS_SESSION_INDEX);
      } else {
        const attachments = req.transaction.objectStore(ATTACHMENTS_STORE);
        if (!attachments.indexNames.contains(ATTACHMENTS_SESSION_INDEX)) {
          attachments.createIndex(ATTACHMENTS_SESSION_INDEX, ATTACHMENTS_SESSION_INDEX);
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error("Could not open session database"));
  });
}

export function dbGetAll(db, storeName = STORE) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("Could not read sessions"));
      tx.onabort = () => reject(tx.error || new Error("Session read was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}

export function dbPut(db, session, storeName = STORE) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save session"));
      tx.onabort = () => reject(tx.error || new Error("Session write was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}

export function dbDelete(db, id, storeName = STORE) {
  return new Promise((resolve, reject) => {
    try {
      const stores = storeName === STORE && db.objectStoreNames.contains(ATTACHMENTS_STORE)
        ? [storeName, ATTACHMENTS_STORE]
        : [storeName];
      const tx = db.transaction(stores, "readwrite");
      tx.objectStore(storeName).delete(id);
      if (stores.includes(ATTACHMENTS_STORE)) {
        const index = tx.objectStore(ATTACHMENTS_STORE).index(ATTACHMENTS_SESSION_INDEX);
        const req = index.openKeyCursor(IDBKeyRange.only(id));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          tx.objectStore(ATTACHMENTS_STORE).delete(cursor.primaryKey);
          cursor.continue();
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not delete session"));
      tx.onabort = () => reject(tx.error || new Error("Session delete was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}
