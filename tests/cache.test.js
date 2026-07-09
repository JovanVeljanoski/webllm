import { describe, expect, it } from "vitest";
import {
  checkModelCached,
  createCacheEnv,
  deleteModelCacheDatabases,
  getModelCacheSize,
  ggufCacheHasModel,
  readModelCacheMeta,
  repairBrokenModelCache,
  responseByteSize,
  sumCacheStorageBytes,
} from "../lib/cache.js";
import { MODELS } from "../lib/models.js";

function makeResponse(size, { contentLength = true } = {}) {
  const headers = new Map();
  if (contentLength) headers.set("Content-Length", String(size));
  return {
    headers: { get: key => headers.get(key) ?? null },
    blob: async () => new Blob([new Uint8Array(size)]),
  };
}

function makeCaches(store = new Map()) {
  return {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const bucket = store.get(name);
      return {
        async keys() {
          return [...bucket.keys()].map(url => new Request(url));
        },
        async match(req) {
          const url = typeof req === "string" ? req : req.url;
          return bucket.get(url) ?? null;
        },
        async put(req, res) {
          bucket.set(req.url, res);
        },
      };
    },
    async delete(name) {
      return store.delete(name);
    },
  };
}

describe("responseByteSize", () => {
  it("reads Content-Length when present", () => {
    expect(responseByteSize(makeResponse(1234))).toBe(1234);
    expect(responseByteSize(makeResponse(1234, { contentLength: false }))).toBeNull();
  });
});

describe("sumCacheStorageBytes", () => {
  it("sums via Content-Length without reading blobs", async () => {
    const caches = makeCaches();
    const cache = await caches.open("webllm-test");
    await cache.put(new Request("https://example.com/a"), makeResponse(100));
    await cache.put(new Request("https://example.com/b"), makeResponse(250));
    const total = await sumCacheStorageBytes("webllm-test", createCacheEnv({
      fileOrigin: false,
      caches,
      indexedDB,
    }));
    expect(total).toBe(350);
  });

  it("falls back to blob size when Content-Length is missing", async () => {
    const caches = makeCaches();
    const cache = await caches.open("webllm-test");
    await cache.put(new Request("https://example.com/blob"), makeResponse(77, { contentLength: false }));
    const total = await sumCacheStorageBytes("webllm-test", createCacheEnv({
      fileOrigin: false,
      caches,
      indexedDB,
    }));
    expect(total).toBe(77);
  });
});

describe("gguf cache detection", () => {
  it("detects hub id in cached URLs", async () => {
    const caches = makeCaches();
    const cache = await caches.open(MODELS.lfm2.cacheName);
    await cache.put(
      new Request(`https://cdn.example.com/${MODELS.lfm2.hubId}/model.gguf`),
      makeResponse(10),
    );
    const env = createCacheEnv({ fileOrigin: false, caches, indexedDB });
    expect(await ggufCacheHasModel(MODELS.lfm2, env)).toBe(true);
    expect(await checkModelCached(MODELS.lfm2, env)).toBe(true);
  });
});

describe("safetensors cache metadata", () => {
  it("reads meta store and sums chunk bytes", async () => {
    const def = MODELS.gemma4;
    const env = createCacheEnv({ fileOrigin: false, caches: makeCaches(), indexedDB });

    await new Promise((resolve, reject) => {
      const req = indexedDB.open(def.cacheName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("meta");
        db.createObjectStore("chunks");
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["meta", "chunks"], "readwrite");
        tx.objectStore("meta").put({ size: 5000 }, def.metaUrl);
        tx.objectStore("chunks").put(new Blob([new Uint8Array(120)]), "chunk-0");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const meta = await readModelCacheMeta(def, env);
    expect(meta.size).toBe(5000);
    const size = await getModelCacheSize(def, env);
    expect(size.stored).toBeGreaterThanOrEqual(120);
    expect(size.declared).toBe(5000);
    expect(await checkModelCached(def, env)).toBe(true);
  });

  it("repairs broken safetensors cache schema", async () => {
    const def = MODELS.gemma4;
    const caches = makeCaches();
    const env = createCacheEnv({ fileOrigin: false, caches, indexedDB });

    await new Promise((resolve, reject) => {
      const del = indexedDB.deleteDatabase(def.cacheName);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });

    await new Promise((resolve, reject) => {
      const req = indexedDB.open(def.cacheName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("wrong");
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });

    const listDatabases = indexedDB.databases?.bind(indexedDB);
    indexedDB.databases = async () => [{ name: def.cacheName }];

    let deleted = false;
    try {
      const repaired = await repairBrokenModelCache(def, env, async () => {
        deleted = true;
      });
      expect(repaired).toBe(true);
      expect(deleted).toBe(true);
    } finally {
      if (listDatabases) indexedDB.databases = listDatabases;
      else delete indexedDB.databases;
    }
  });
});

describe("deleteModelCacheDatabases", () => {
  it("deletes gguf cache buckets", async () => {
    const store = new Map();
    const caches = makeCaches(store);
    const env = createCacheEnv({ fileOrigin: false, caches, indexedDB });
    await caches.open(MODELS.lfm2.cacheName);
    await caches.open(`${MODELS.lfm2.cacheName}-headers`);
    await deleteModelCacheDatabases(MODELS.lfm2, env);
    expect(store.has(MODELS.lfm2.cacheName)).toBe(false);
    expect(store.has(`${MODELS.lfm2.cacheName}-headers`)).toBe(false);
  });
});
