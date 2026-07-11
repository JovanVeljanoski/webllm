import { describe, expect, it } from "vitest";
import { AgentStepStore } from "../lib/agent-step-store.js";

describe("AgentStepStore", () => {
  it("builds planning → tool → result → synthesis → answer sequence", () => {
    const store = new AgentStepStore();
    store.beginThinking("Planning");
    store.updateThinking("Need to search.");
    store.addToolCall("gemma 4 release date");
    store.addToolResult({
      query: "gemma 4 release date",
      content: "[1] Example",
      resultCount: 3,
      status: "ok",
    });
    store.beginThinking("Synthesis");
    store.updateThinking("Summarizing…");
    store.updateAnswer("Gemma 4 was released in …");
    store.finalizeAnswer({ content: "Gemma 4 was released in …", meta: { tokens: 42 } });

    const steps = store.snapshot();
    expect(steps.map(s => s.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "thinking",
      "answer",
    ]);
    expect(steps[0].thinking).toBe("Need to search.");
    expect(steps[1].searching).toBe(false);
    expect(steps[2].content).toContain("[1]");
    expect(steps[4].meta.tokens).toBe(42);
  });

  it("replaces synthesis thinking on retry instead of stacking", () => {
    const store = new AgentStepStore();
    store.beginThinking("Synthesis");
    store.updateThinking("First attempt");
    store.updateAnswer("too short");
    store.beginThinking("Synthesis");
    store.updateThinking("Second attempt");

    const steps = store.snapshot();
    expect(steps.filter(s => s.type === "thinking" && s.label === "Synthesis")).toHaveLength(1);
    expect(steps[0].thinking).toBe("Second attempt");
  });

  it("streams a direct answer during planning when no tool call is emitted", () => {
    const store = new AgentStepStore();
    store.beginThinking("Planning");
    store.updateThinking("Reasoning about a follow-up.");
    store.updateAnswer("Partial answer");
    store.updateAnswer("Partial answer keeps growing");

    const steps = store.snapshot();
    expect(steps.map(s => s.type)).toEqual(["thinking", "answer"]);
    expect(steps[1].content).toBe("Partial answer keeps growing");
    expect(steps[1].streaming).toBe(true);
  });

  it("can keep planning open while answer step is created", () => {
    const store = new AgentStepStore();
    store.beginThinking("Planning");
    store.updateThinking("Still reasoning");
    store.updateAnswer("Partial answer", { closeThinking: false });
    expect(store.snapshot().find(s => s.type === "thinking")?.streaming).toBe(true);
    expect(store.snapshot().find(s => s.type === "answer")?.content).toBe("Partial answer");
  });

  it("drops empty planning and spurious answer steps when tool call starts", () => {
    const store = new AgentStepStore();
    store.beginThinking("Planning");
    store.updateAnswer('<|tool_call|>call:web_search{query:"x"}');
    store.addToolCall("x");

    const steps = store.snapshot();
    expect(steps.map(s => s.type)).toEqual(["tool_call"]);
  });

  it("removes empty synthesis thinking at finalization", () => {
    const store = new AgentStepStore();
    store.beginThinking("Synthesis");
    store.finalizeAnswer({ content: "Final answer with enough prose here." });

    expect(store.snapshot().some(s => s.type === "thinking" && s.label === "Synthesis")).toBe(false);
  });
});
