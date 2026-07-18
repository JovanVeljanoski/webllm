import { describe, expect, it } from "vitest";
import { agentMessagesToSteps } from "../lib/agent-ui.js";

describe("agentMessagesToSteps", () => {
  it("keeps each generation's thinking attached to that message", () => {
    const steps = agentMessagesToSteps([
      {
        role: "assistant",
        content: null,
        thinking: "search thought",
        tool_calls: [{
          id: "c1",
          function: {
            name: "web_search",
            arguments: { queries: ["winner"] },
          },
        }],
      },
      {
        role: "tool",
        name: "web_search",
        tool_call_id: "c1",
        content: "results",
        meta: { query: "winner", resultCount: 2 },
      },
      {
        role: "assistant",
        content: "Brazil won.",
        thinking: "answer thought",
      },
    ]);

    expect(steps.map(step => step.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "thinking",
      "answer",
    ]);
    expect(steps.filter(step => step.type === "thinking")
      .map(step => step.thinking)).toEqual([
      "search thought",
      "answer thought",
    ]);
  });

  it("only shows a thinking step after thinking text exists", () => {
    expect(agentMessagesToSteps([], {
      streamingMessage: { role: "assistant", content: null, thinking: "" },
    })).toEqual([]);
  });

  it("shows prefill as temporary runtime status, then replaces it with output", () => {
    expect(agentMessagesToSteps([], {
      streamingMessage: { role: "assistant", content: null, thinking: "" },
      runtimeStatus: { active: true, label: "Prefill" },
    })).toEqual([{
      key: "assistant:0:runtime",
      type: "runtime_status",
      label: "Prefill",
      streaming: true,
    }]);

    expect(agentMessagesToSteps([], {
      streamingMessage: { role: "assistant", content: null, thinking: "reasoning" },
      runtimeStatus: { active: true, label: "Prefill" },
    }).map(step => step.type)).toEqual(["thinking"]);
  });

  it("keeps the runtime step stable while a tool call is being assembled", () => {
    const prefill = agentMessagesToSteps([], {
      streamingMessage: { role: "assistant", content: null, thinking: "" },
      runtimeStatus: { active: true, label: "Prefill" },
    });
    const toolCall = agentMessagesToSteps([], {
      streamingMessage: { role: "assistant", content: null, thinking: "" },
      runtimeStatus: { active: true, label: "Tool call" },
    });

    expect(prefill[0].key).toBe(toolCall[0].key);
    expect(toolCall[0].label).toBe("Tool call");
  });

  it("keeps step keys stable when a streaming message is finalized", () => {
    const message = {
      role: "assistant",
      content: "Answer",
      thinking: "reasoning",
    };
    const streaming = agentMessagesToSteps([], { streamingMessage: message });
    const finalized = agentMessagesToSteps([message]);

    expect(streaming.map(step => step.key)).toEqual(finalized.map(step => step.key));
  });
});
