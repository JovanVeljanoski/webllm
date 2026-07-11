/** @typedef {'thinking'|'tool_call'|'tool_result'|'answer'} AgentStepType */

/**
 * @typedef {object} AgentStep
 * @property {AgentStepType} type
 * @property {string} [label]
 * @property {string} [thinking]
 * @property {string} [query]
 * @property {string} [content]
 * @property {number} [resultCount]
 * @property {string} [status]
 * @property {boolean} [searching]
 * @property {boolean} [streaming]
 * @property {object} [meta]
 */

export class AgentStepStore {
  constructor() {
    /** @type {AgentStep[]} */
    this.steps = [];
  }

  /** @param {AgentStepType} type */
  #findLastIndex(type) {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].type === type) return i;
    }
    return -1;
  }

  /** @param {string} label */
  beginThinking(label) {
    const idx = this.#findLastIndex("thinking");
    if (idx >= 0 && this.steps[idx].label === label) {
      this.steps[idx].thinking = "";
      this.steps[idx].streaming = true;
      this.steps.length = idx + 1;
      return idx;
    }
    this.steps.push({
      type: "thinking",
      label,
      thinking: "",
      streaming: true,
    });
    return this.steps.length - 1;
  }

  /** @param {string} thinking */
  updateThinking(thinking) {
    const idx = this.#findLastIndex("thinking");
    if (idx < 0) return;
    this.steps[idx].thinking = thinking;
  }

  finishThinking() {
    const idx = this.#findLastIndex("thinking");
    if (idx < 0) return;
    this.steps[idx].streaming = false;
  }

  /** @param {string} query */
  addToolCall(query) {
    this.removeEmptyPlanningStep();
    this.removeSpuriousAnswerSteps();
    this.finishThinking();
    this.steps.push({
      type: "tool_call",
      query,
      searching: true,
      streaming: true,
    });
    return this.steps.length - 1;
  }

  finishToolCall() {
    const idx = this.#findLastIndex("tool_call");
    if (idx < 0) return;
    this.steps[idx].searching = false;
    this.steps[idx].streaming = false;
  }

  /**
   * @param {{ query: string, content: string, resultCount?: number, status?: string }} payload
   */
  addToolResult(payload) {
    this.finishToolCall();
    this.steps.push({
      type: "tool_result",
      query: payload.query,
      content: payload.content,
      resultCount: payload.resultCount ?? 0,
      status: payload.status ?? "ok",
      streaming: false,
    });
    return this.steps.length - 1;
  }

  /** @param {string} content @param {{ closeThinking?: boolean }} [options] */
  updateAnswer(content, { closeThinking = true } = {}) {
    const idx = this.#findLastIndex("answer");
    if (idx >= 0) {
      this.steps[idx].content = content;
      this.steps[idx].streaming = true;
      return idx;
    }
    if (closeThinking) this.finishThinking();
    this.steps.push({
      type: "answer",
      content,
      streaming: true,
    });
    return this.steps.length - 1;
  }

  /** @param {{ content: string, meta?: object }} payload */
  finalizeAnswer(payload) {
    this.finishThinking();
    this.removeSpuriousAnswerSteps();
    this.removeEmptyThinkingSteps();
    const idx = this.#findLastIndex("answer");
    if (idx >= 0) {
      this.steps[idx].content = payload.content;
      this.steps[idx].meta = payload.meta;
      this.steps[idx].streaming = false;
      return;
    }
    this.steps.push({
      type: "answer",
      content: payload.content,
      meta: payload.meta,
      streaming: false,
    });
  }

  /** Drop planning bubble when the model never emitted visible reasoning. */
  removeEmptyPlanningStep() {
    const idx = this.steps.findIndex(
      s => s.type === "thinking" && s.label === "Planning" && !(s.thinking || "").trim(),
    );
    if (idx >= 0) this.steps.splice(idx, 1);
  }

  removeEmptyThinkingSteps() {
    this.steps = this.steps.filter(
      step => step.type !== "thinking" || Boolean((step.thinking || "").trim()),
    );
  }

  /** Answer steps belong only in synthesis — not when a tool call was misrouted. */
  removeSpuriousAnswerSteps() {
    this.steps = this.steps.filter(s => s.type !== "answer");
  }

  /** @returns {AgentStep[]} */
  snapshot() {
    return this.steps.map(step => ({ ...step }));
  }
}
