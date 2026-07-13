/** @file Token-aware conversation fitting against model context windows. */

export const CONTEXT_SAFETY_TOKENS = 256;

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

  const inputBudget = Math.max(
    1,
    Math.floor(contextWindowTokens)
      - Math.max(0, Math.floor(maxNewTokens || 0))
      - Math.max(0, Math.floor(safetyTokens)),
  );
  const fullCount = countTokens(messages);
  if (!Number.isFinite(fullCount) || fullCount <= inputBudget) return messages;

  const { prefix, turns } = splitTurns(messages);
  while (turns.length > 1) {
    turns.shift();
    const candidate = [...prefix, ...turns.flat()];
    if (countTokens(candidate) <= inputBudget) return candidate;
  }

  const required = countTokens([...prefix, ...turns.flat()]);
  throw new RangeError(
    `The current turn requires ${required} input tokens, but this model allows `
      + `${inputBudget} after reserving output space.`,
  );
}
