/** @file Run native regular expressions without exposing the UI thread to ReDoS. */

export const REGEX_SEARCH_TIMEOUT_MS = 1_000;

function abortError() {
  return new DOMException("Operation aborted", "AbortError");
}

export function createRegexSearchWorker() {
  if (typeof Worker !== "function") {
    throw new Error("Regex search is unavailable in this browser.");
  }
  return new Worker(
    new URL("./regex-search-worker.js", import.meta.url),
    { type: "module", name: "uploaded-file-regex-search" },
  );
}

export function searchRegexInWorker(files, {
  pattern,
  ignoreCase = true,
  limit = 20,
  signal,
  timeoutMs = REGEX_SEARCH_TIMEOUT_MS,
  workerFactory = createRegexSearchWorker,
} = {}) {
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    let timer = null;

    const finish = callback => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker?.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));

    try {
      worker = workerFactory();
      worker.onmessage = event => {
        const message = event.data || {};
        if (message.ok) {
          finish(() => resolve(message.result));
          return;
        }
        const error = new Error(message.error?.message || "Regex search failed.");
        error.name = message.error?.name || "Error";
        finish(() => reject(error));
      };
      worker.onerror = event => {
        finish(() => reject(new Error(event?.message || "Regex search worker failed.")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        finish(() => reject(new Error(
          `Regex search timed out after ${timeoutMs} ms. `
          + "Refine the pattern or retry with literal=true.",
        )));
      }, timeoutMs);
      if (settled) {
        clearTimeout(timer);
        timer = null;
        return;
      }
      worker.postMessage({
        files: (files || []).map(file => ({
          attachmentId: file.id,
          path: String(file.virtualPath || ""),
          content: String(file.content || ""),
        })),
        pattern: String(pattern || ""),
        ignoreCase: Boolean(ignoreCase),
        limit,
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
