/** @file Worker-only regex scanning for uploaded text files. */

function compileRegex(pattern, ignoreCase) {
  try {
    return new RegExp(pattern, ignoreCase ? "iu" : "u");
  } catch (error) {
    throw new Error(
      `Invalid regular expression: ${error.message}. `
      + "Fix the pattern or retry with literal=true.",
    );
  }
}

/**
 * Run only inside a disposable worker in production. Native RegExp matching can
 * catastrophically backtrack, so the host enforces a deadline by terminating
 * the worker.
 */
export function scanRegexFiles(files, {
  pattern,
  ignoreCase = true,
  limit = 20,
} = {}) {
  const expression = compileRegex(pattern, ignoreCase);
  const effectiveLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const matches = [];
  let hasMore = false;

  const record = match => {
    if (matches.length >= effectiveLimit) {
      hasMore = true;
      return false;
    }
    matches.push(match);
    return true;
  };

  outer:
  for (const file of files || []) {
    const path = String(file.path || "");
    if (expression.test(path)) {
      if (!record({
        attachmentId: file.attachmentId,
        path,
        line: 0,
      })) {
        break;
      }
    }

    const lines = String(file.content || "").split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!expression.test(lines[index])) continue;
      if (!record({
        attachmentId: file.attachmentId,
        path,
        line: index + 1,
      })) {
        break outer;
      }
    }
  }

  return { matches, hasMore };
}
