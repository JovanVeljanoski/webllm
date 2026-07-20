/** @file Disposable worker entry point for deadline-bounded regex search. */

import { scanRegexFiles } from "./regex-search-core.js";

self.onmessage = event => {
  try {
    self.postMessage({
      ok: true,
      result: scanRegexFiles(event.data?.files, event.data || {}),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
      },
    });
  } finally {
    self.close();
  }
};
