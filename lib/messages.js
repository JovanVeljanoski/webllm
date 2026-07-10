/** @file Chat message building, grammar, thinking traces, export. */

export function buildGrammarSuffix({ grammarMode, jsonSchema = "", ebnf = "" } = {}) {
  if (grammarMode === "off") return "";
  if (grammarMode === "json") {
    const schema = jsonSchema.trim();
    let block = "\n\n[GRAMMAR — respond with valid JSON only. No markdown fences, no prose outside JSON.]";
    block += schema ? `\nConform to this JSON Schema:\n${schema}` : "\nOutput a single valid JSON value.";
    return block;
  }
  if (grammarMode === "ebnf") {
    const trimmed = ebnf.trim();
    if (!trimmed) return "";
    return `\n\n[GRAMMAR — output only text matching this EBNF. No explanation.]\n\`\`\`ebnf\n${trimmed}\n\`\`\``;
  }
  return "";
}

export function buildEffectiveSystemPrompt(base, grammarConfig) {
  const trimmed = (base || "").trim();
  const suffix = buildGrammarSuffix(grammarConfig);
  return trimmed || suffix ? trimmed + suffix : "";
}

export function buildMessages(session, grammarConfig) {
  const msgs = [];
  const sys = buildEffectiveSystemPrompt(session.systemPrompt, grammarConfig);
  if (sys) msgs.push({ role: "system", content: sys });
  for (const m of session.messages) {
    if (m.role === "user") msgs.push({ role: "user", content: m.content });
    else if (m.role === "assistant") msgs.push({ role: "assistant", content: m.content });
  }
  return msgs;
}

/** OpenAI Chat Completions message list — portable JSON export (role + content only). */
export function exportSessionOpenAI(session) {
  const msgs = [];
  const sys = (session.systemPrompt || "").trim();
  if (sys) msgs.push({ role: "system", content: sys });
  for (const m of session.messages) {
    if (m.role === "user" || m.role === "assistant") {
      msgs.push({ role: m.role, content: m.content });
    }
  }
  return msgs;
}

export function splitThinking(raw) {
  const text = raw || "";
  let thinking = "";
  let output = text;
  const OPENERS = ["<|channel>thought", "<|think|>"];
  let openIdx = -1;
  let openLen = 0;
  for (const op of OPENERS) {
    const i = text.indexOf(op);
    if (i !== -1 && (openIdx === -1 || i < openIdx)) {
      openIdx = i;
      openLen = op.length;
    }
  }
  if (openIdx !== -1) {
    const before = text.slice(0, openIdx);
    const after = text.slice(openIdx + openLen).replace(/^\n+/, "");
    const close = after.indexOf("<channel|>");
    if (close !== -1) {
      thinking = after.slice(0, close).trim();
      output = (after.slice(close + "<channel|>".length).replace(/^\n+/, "") + before).trim();
    } else {
      thinking = after.trim();
      output = "";
    }
  }
  return {
    thinking,
    output: output
      .replace(/<\|channel>thought/g, "")
      .replace(/<\|think|>/g, "")
      .replace(/<channel\|>/g, "")
      .replace(/^\n+/, "")
      .trim(),
  };
}
