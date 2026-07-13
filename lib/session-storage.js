/** @file Chat session IndexedDB access. */

import { DB_NAME, DB_VERSION, STORE } from "./constants.js";

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
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not delete session"));
      tx.onabort = () => reject(tx.error || new Error("Session delete was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}
