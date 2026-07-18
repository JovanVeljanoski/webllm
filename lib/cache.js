/** @file Model weight cache introspection and maintenance. */

import { MODELS } from "./models.js";

/**
 * @typedef {object} CacheEnv
 * @property {boolean} fileOrigin
 * @property {typeof indexedDB | undefined} indexedDB
 * @property {CacheStorage | undefined} caches
 */

export function responseByteSize(res) {
  const contentLength = res.headers.get("Content-Length");
  if (contentLength != null) {
    const n = parseInt(contentLength, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export async function sumCacheStorageBytes(cacheName, env) {
  if (!env.caches || env.fileOrigin || !cacheName) return 0;
  try {
    const cache = await env.caches.open(cacheName);
    const keys = await cache.keys();
    let total = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const fromHeader = responseByteSize(res);
      if (fromHeader != null) {
        total += fromHeader;
        continue;
      }
      total += (await res.blob()).size;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function readModelCacheMeta(def, env) {
  if (!def || def.cacheType !== "safetensors" || !env.indexedDB || env.fileOrigin) return null;
  try {
    return await new Promise(resolve => {
      const req = env.indexedDB.open(def.cacheName);
      req.onupgradeneeded = () => { req.result.close(); resolve(null); };
      req.onblocked = () => resolve(null);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("meta")) {
          db.close();
          resolve(null);
          return;
        }
        const tx = db.transaction("meta", "readonly");
        const getReq = tx.objectStore("meta").get(def.metaUrl);
        getReq.onsuccess = () => { resolve(getReq.result ?? null); db.close(); };
        getReq.onerror = () => { resolve(null); db.close(); };
      };
    });
  } catch {
    return null;
  }
}

export function ggufResolveUrl(def) {
  if (!def?.hubId) return null;
  const revision = def.revision ?? "main";
  if (def.ggufFile) {
    return `https://huggingface.co/${def.hubId}/resolve/${revision}/${def.ggufFile}`;
  }
  return `https://huggingface.co/${def.hubId}/resolve/${revision}`;
}

async function openIndexedDb(name, env) {
  if (!env.indexedDB || env.fileOrigin || !name) return null;
  try {
    if (env.indexedDB.databases) {
      const dbs = await env.indexedDB.databases();
      if (!dbs.some(d => d.name === name)) return null;
    }
  } catch {
    return null;
  }
  return new Promise(resolve => {
    // Open at the current version only — never pass an explicit version here.
    // Passing version 2 and closing in onupgradeneeded can poison the DB with
    // no object stores, which breaks the GGUF runtime on the next load.
    const req = env.indexedDB.open(name);
    req.onupgradeneeded = () => {
      req.transaction?.abort();
      req.result.close();
      resolve(null);
    };
    req.onblocked = () => resolve(null);
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
  });
}

async function ggufIndexedDbHasModel(def, env) {
  const db = await openIndexedDb(def?.cacheName, env);
  if (!db) return false;
  try {
    const cacheKey = ggufResolveUrl(def);
    if (db.objectStoreNames.contains("meta")) {
      const meta = await new Promise((resolve, reject) => {
        const tx = db.transaction("meta", "readonly");
        const getReq = tx.objectStore("meta").get(cacheKey);
        getReq.onsuccess = () => resolve(getReq.result ?? null);
        getReq.onerror = () => reject(getReq.error);
      });
      if (meta?.size && Number.isFinite(meta.size)) return true;

      const anyMeta = await new Promise((resolve, reject) => {
        const tx = db.transaction("meta", "readonly");
        const cursorReq = tx.objectStore("meta").openCursor();
        cursorReq.onsuccess = ev => {
          const cursor = ev.target.result;
          if (!cursor) {
            resolve(false);
            return;
          }
          if (cursor.value?.size && Number.isFinite(cursor.value.size)) {
            resolve(true);
            return;
          }
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      if (anyMeta) return true;
    }

    if (db.objectStoreNames.contains("chunks")) {
      const count = await new Promise((resolve, reject) => {
        const tx = db.transaction("chunks", "readonly");
        const countReq = tx.objectStore("chunks").count();
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => reject(countReq.error);
      });
      return count > 0;
    }
    return false;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

async function sumGgufIndexedDbChunkBytes(def, env) {
  const db = await openIndexedDb(def?.cacheName, env);
  if (!db || !db.objectStoreNames.contains("chunks")) {
    db?.close();
    return 0;
  }
  try {
    return await new Promise(resolve => {
      const tx = db.transaction("chunks", "readonly");
      // Runtime chunk keys are [resolveUrl, rangeStart, rangeEnd]. Walk only
      // keys so browsers never deserialize multi-gigabyte Blob values merely
      // to render the storage summary.
      const cursorReq = tx.objectStore("chunks").openKeyCursor();
      const cacheKey = ggufResolveUrl(def);
      let total = 0;
      cursorReq.onsuccess = ev => {
        const cursor = ev.target.result;
        if (!cursor) {
          db.close();
          resolve(total);
          return;
        }
        const [url, start, end] = Array.isArray(cursor.key) ? cursor.key : [];
        if (
          (!cacheKey || url === cacheKey)
          && Number.isFinite(start)
          && Number.isFinite(end)
          && end >= start
        ) {
          total += end - start;
        }
        cursor.continue();
      };
      cursorReq.onerror = () => { db.close(); resolve(0); };
    });
  } catch {
    db?.close();
    return 0;
  }
}

export async function sumIndexedDbChunkBytes(def, env) {
  if (!def || def.cacheType !== "safetensors" || !env.indexedDB || env.fileOrigin) return 0;
  try {
    return await new Promise(resolve => {
      const req = env.indexedDB.open(def.cacheName);
      req.onupgradeneeded = () => { req.result.close(); resolve(0); };
      req.onblocked = () => resolve(0);
      req.onerror = () => resolve(0);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("chunks")) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction("chunks", "readonly");
        const cursorReq = tx.objectStore("chunks").openCursor();
        let total = 0;
        cursorReq.onsuccess = ev => {
          const cursor = ev.target.result;
          if (!cursor) {
            db.close();
            resolve(total);
            return;
          }
          const val = cursor.value;
          if (val instanceof Blob) total += val.size;
          else if (val?.byteLength) total += val.byteLength;
          cursor.continue();
        };
        cursorReq.onerror = () => { db.close(); resolve(0); };
      };
    });
  } catch {
    return 0;
  }
}

export async function getModelCacheSize(def, env) {
  if (!def) return { stored: 0, declared: null };
  if (def.cacheType === "gguf") {
    const [chunkBytes, headerBytes] = await Promise.all([
      sumGgufIndexedDbChunkBytes(def, env),
      sumCacheStorageBytes(`${def.cacheName}-headers`, env),
    ]);
    const stored = chunkBytes + headerBytes;
    return { stored, declared: def.declaredBytes ?? null };
  }
  const [meta, chunkBytes, configBytes] = await Promise.all([
    readModelCacheMeta(def, env),
    sumIndexedDbChunkBytes(def, env),
    sumCacheStorageBytes(def.cacheName, env),
  ]);
  const stored = chunkBytes + configBytes;
  const declared = meta?.size && Number.isFinite(meta.size) ? meta.size : (def.declaredBytes ?? null);
  return { stored, declared };
}

export async function repairPoisonedGgufCache(def, env) {
  if (!def || def.cacheType !== "gguf" || !env.indexedDB || env.fileOrigin) return false;
  const db = await openIndexedDb(def.cacheName, env);
  if (!db) return false;
  try {
    const hasStores =
      db.objectStoreNames.contains("chunks")
      || db.objectStoreNames.contains("meta");
    db.close();
    if (hasStores) return false;
    await deleteModelCacheDatabases(def, env);
    return true;
  } catch {
    db?.close();
    return false;
  }
}

export async function ggufCacheHasModel(def, env) {
  if (!def || env.fileOrigin) return false;
  if (await ggufIndexedDbHasModel(def, env)) return true;
  if (!env.caches) return false;
  const hints = [def.hubId, ...def.hubId.split("/")].filter(Boolean);
  if (def.ggufFile) hints.push(def.ggufFile);
  for (const name of [`${def.cacheName}-headers`]) {
    try {
      const cache = await env.caches.open(name);
      const keys = await cache.keys();
      if (keys.some(k => hints.some(h => k.url.includes(h)))) return true;
    } catch { /* ignore */ }
  }
  return false;
}

export async function checkModelCached(def, env) {
  if (!def || env.fileOrigin) return false;
  if (def.cacheType === "gguf") {
    return ggufCacheHasModel(def, env);
  }
  if (!env.indexedDB) return false;
  try {
    if (env.indexedDB.databases) {
      const dbs = await env.indexedDB.databases();
      if (!dbs.some(d => d.name === def.cacheName)) return false;
    }
    return await new Promise(resolve => {
      const req = env.indexedDB.open(def.cacheName);
      req.onupgradeneeded = () => { req.result.close(); resolve(false); };
      req.onblocked = () => resolve(false);
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("meta")) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction("meta", "readonly");
        const getReq = tx.objectStore("meta").get(def.metaUrl);
        getReq.onsuccess = () => { resolve(!!getReq.result); db.close(); };
        getReq.onerror = () => { resolve(false); db.close(); };
      };
    });
  } catch {
    return false;
  }
}

export async function getAllModelsCacheStats(env, models = MODELS) {
  const entries = await Promise.all(
    Object.values(models).map(async def => {
      const cached = await checkModelCached(def, env);
      if (!cached) return null;
      const size = await getModelCacheSize(def, env);
      return { def, ...size };
    })
  );
  const cached = entries.filter(Boolean);
  const stored = cached.reduce((sum, entry) => sum + entry.stored, 0);
  const declared = cached.reduce((sum, entry) => sum + (entry.declared ?? 0), 0);
  return {
    modelCount: cached.length,
    stored,
    declared: declared > 0 ? declared : null,
    cachedModels: cached.map(entry => entry.def),
  };
}

export async function modelCacheSchemaOk(def, env) {
  if (!def) return false;
  if (def.cacheType !== "gguf") {
    if (!env.indexedDB || env.fileOrigin) return true;
    return new Promise(resolve => {
      const req = env.indexedDB.open(def.cacheName);
      req.onupgradeneeded = () => { req.result.close(); resolve(false); };
      req.onblocked = () => resolve(false);
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        const ok = db.objectStoreNames.contains("meta") && db.objectStoreNames.contains("chunks");
        db.close();
        resolve(ok);
      };
    });
  }
  return true;
}

export async function repairBrokenModelCache(def, env, deleteModelCache) {
  if (!def || def.cacheType === "gguf" || env.fileOrigin || !env.indexedDB) return false;
  try {
    if (env.indexedDB.databases) {
      const dbs = await env.indexedDB.databases();
      if (!dbs.some(d => d.name === def.cacheName)) return false;
    }
    const schemaOk = await modelCacheSchemaOk(def, env);
    if (!schemaOk) {
      await deleteModelCache(def);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function deleteModelCacheDatabases(def, env) {
  if (!def) return Promise.resolve();
  const ops = [];
  if (env.caches) ops.push(env.caches.delete(def.cacheName));
  if (def.cacheType === "gguf") {
    if (env.caches) {
      ops.push(env.caches.delete(def.cacheName));
      ops.push(env.caches.delete(`${def.cacheName}-headers`));
    }
    if (env.indexedDB) {
      ops.push(new Promise((resolve, reject) => {
        const req = env.indexedDB.deleteDatabase(def.cacheName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("Cache database is in use — refresh the page, then try again."));
      }));
    }
  } else if (env.indexedDB) {
    ops.push(new Promise((resolve, reject) => {
      const req = env.indexedDB.deleteDatabase(def.cacheName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Cache database is in use — refresh the page, then try again."));
    }));
  }
  return Promise.all(ops);
}

export async function deleteAllModelCaches(env, models = MODELS) {
  await Promise.all(Object.values(models).map(def => deleteModelCacheDatabases(def, env)));
}

export function createCacheEnv({ fileOrigin, indexedDB = globalThis.indexedDB, caches = globalThis.caches } = {}) {
  return { fileOrigin: !!fileOrigin, indexedDB, caches };
}
