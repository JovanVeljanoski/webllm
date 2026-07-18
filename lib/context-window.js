/** @file Token-aware conversation fitting against model context windows. */

export const CONTEXT_SAFETY_TOKENS = 256;
/** Minimum prompt space to preserve when capping maxNewTokens against a small window. */
export const MIN_INPUT_BUDGET = 512;
/** Smallest output reservation when checking whether a single turn can fit at all. */
export const MIN_OUTPUT_RESERVE = 64;

function inputBudgetForOutputReserve(contextWindowTokens, outputReserve, safetyTokens) {
  return Math.max(
    1,
    Math.floor(contextWindowTokens)
      - Math.max(0, Math.floor(outputReserve))
      - Math.max(0, Math.floor(safetyTokens)),
  );
}

/**
 * Cap generation length so prompt fitting leaves room for input + safety margin.
 * @returns {number}
 */
export function capMaxNewTokensForContext(maxNewTokens, contextWindowTokens, {
  safetyTokens = CONTEXT_SAFETY_TOKENS,
  minInputBudget = MIN_INPUT_BUDGET,
} = {}) {
  if (!Number.isFinite(contextWindowTokens)) return maxNewTokens;
  const window = Math.floor(contextWindowTokens);
  const safety = Math.max(0, Math.floor(safetyTokens));
  const inputFloor = Math.max(0, Math.floor(minInputBudget));
  const outputCeiling = Math.max(64, window - safety - inputFloor);
  const requested = Math.max(0, Math.floor(maxNewTokens || 0));
  return Math.min(requested, outputCeiling);
}

/**
 * Apply context cap plus optional per-model default max-new-tokens.
 * @param {number} maxNewTokens
 * @param {{ contextWindowTokens?: number, defaultMaxNewTokens?: number }|null|undefined} modelDef
 * @returns {number}
 */
export function effectiveMaxNewTokens(maxNewTokens, modelDef, options = {}) {
  const capped = capMaxNewTokensForContext(
    maxNewTokens,
    modelDef?.contextWindowTokens,
    options,
  );
  const modelDefault = modelDef?.defaultMaxNewTokens;
  if (!Number.isFinite(modelDefault)) return capped;
  return Math.min(capped, Math.max(MIN_OUTPUT_RESERVE, Math.floor(modelDefault)));
}

function splitTurns(messages) {
  const prefix = [];
  const turns = [];
  let current = [];
  for (const message of messages || []) {
    if (message?.role === "system" && !turns.length && !current.length) {
      prefix.push(message);
      continue;
    }
    if (message?.role === "user" && current.length) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) turns.push(current);
  return { prefix, turns };
}

export function fitMessagesToContext(messages, {
  contextWindowTokens,
  maxNewTokens,
  countTokens,
  safetyTokens = CONTEXT_SAFETY_TOKENS,
} = {}) {
  if (
    !Number.isFinite(contextWindowTokens)
    || typeof countTokens !== "function"
  ) {
    return messages;
  }

  const outputReserve = capMaxNewTokensForContext(maxNewTokens, contextWindowTokens, {
    safetyTokens,
  });
  const inputBudget = inputBudgetForOutputReserve(
    contextWindowTokens,
    outputReserve,
    safetyTokens,
  );
  const maxInputBudget = inputBudgetForOutputReserve(
    contextWindowTokens,
    MIN_OUTPUT_RESERVE,
    safetyTokens,
  );
  const fullCount = countTokens(messages);
  if (!Number.isFinite(fullCount) || fullCount <= inputBudget) return messages;

  const { prefix, turns } = splitTurns(messages);
  while (turns.length > 1) {
    turns.shift();
    const candidate = [...prefix, ...turns.flat()];
    const candidateCount = countTokens(candidate);
    if (candidateCount <= inputBudget || candidateCount <= maxInputBudget) {
      return candidate;
    }
  }

  const required = countTokens([...prefix, ...turns.flat()]);
  if (required <= maxInputBudget) {
    return [...prefix, ...turns.flat()];
  }
  throw new RangeError(
    `The current turn requires ${required} input tokens, but this model allows `
      + `${maxInputBudget} after reserving output space.`,
  );
}
