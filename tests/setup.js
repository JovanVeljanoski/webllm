import "fake-indexeddb/auto";
import { scanRegexFiles } from "../lib/regex-search-core.js";

class TestRegexWorker {
  onmessage = null;
  onerror = null;

  postMessage(data) {
    queueMicrotask(() => {
      try {
        this.onmessage?.({
          data: {
            ok: true,
            result: scanRegexFiles(data.files, data),
          },
        });
      } catch (error) {
        this.onmessage?.({
          data: {
            ok: false,
            error: { name: error.name, message: error.message },
          },
        });
      }
    });
  }

  terminate() {}
}

globalThis.Worker = TestRegexWorker;
