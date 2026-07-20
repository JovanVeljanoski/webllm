/** @file IndexedDB operations for conversation-scoped file attachments. */

import {
  ATTACHMENTS_SESSION_INDEX,
  ATTACHMENTS_STORE,
  STORE,
} from "./constants.js";

function requestResult(request, fallbackMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(fallbackMessage));
  });
}

export function dbGetSessionAttachments(db, sessionId) {
  try {
    const tx = db.transaction(ATTACHMENTS_STORE, "readonly");
    const index = tx.objectStore(ATTACHMENTS_STORE).index(ATTACHMENTS_SESSION_INDEX);
    return requestResult(
      index.getAll(IDBKeyRange.only(String(sessionId))),
      "Could not read conversation files",
    ).then(result => (result || []).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    ));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function dbPutAttachment(db, attachment) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ATTACHMENTS_STORE, "readwrite");
      tx.objectStore(ATTACHMENTS_STORE).put(attachment);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save file"));
      tx.onabort = () => reject(tx.error || new Error("File save was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}

export function dbDeleteAttachment(db, id) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ATTACHMENTS_STORE, "readwrite");
      tx.objectStore(ATTACHMENTS_STORE).delete(String(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not remove file"));
      tx.onabort = () => reject(tx.error || new Error("File removal was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}

export function dbCleanupOrphanAttachments(db) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE, ATTACHMENTS_STORE], "readwrite");
      const sessions = tx.objectStore(STORE);
      const attachments = tx.objectStore(ATTACHMENTS_STORE);
      const sessionIds = new Set();
      const sessionsRequest = sessions.openKeyCursor();
      sessionsRequest.onsuccess = () => {
        const cursor = sessionsRequest.result;
        if (cursor) {
          sessionIds.add(String(cursor.primaryKey));
          cursor.continue();
          return;
        }
        const attachmentsRequest = attachments.openCursor();
        attachmentsRequest.onsuccess = () => {
          const attachmentCursor = attachmentsRequest.result;
          if (!attachmentCursor) return;
          if (!sessionIds.has(String(attachmentCursor.value?.sessionId || ""))) {
            attachmentCursor.delete();
          }
          attachmentCursor.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not clean up orphan files"));
      tx.onabort = () => reject(tx.error || new Error("Orphan cleanup was aborted"));
    } catch (error) {
      reject(error);
    }
  });
}
