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
    const [mainBytes, headerBytes] = await Promise.all([
      sumCacheStorageBytes(def.cacheName, env),
      sumCacheStorageBytes(`${def.cacheName}-headers`, env),
    ]);
    const stored = mainBytes + headerBytes;
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

export async function ggufCacheHasModel(def, env) {
  if (!env.caches || !def) return false;
  const hints = [def.hubId, ...def.hubId.split("/")].filter(Boolean);
  for (const name of [def.cacheName, `${def.cacheName}-headers`]) {
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
    if (env.caches) ops.push(env.caches.delete(`${def.cacheName}-headers`));
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
