import { describe, expect, it } from "vitest";
import { TOOL_SYSTEM_GUARD, TOOL_USE_INSTRUCTION, WEB_SEARCH_TOOL, WEB_SEARCH_TOOLS } from "../lib/tools.js";

describe("WEB_SEARCH_TOOLS", () => {
  it("defines a single web_search function tool", () => {
    expect(WEB_SEARCH_TOOLS).toHaveLength(1);
    expect(WEB_SEARCH_TOOL.function.name).toBe("web_search");
    expect(WEB_SEARCH_TOOL.function.parameters.additionalProperties).toBe(false);
    expect(WEB_SEARCH_TOOL.function.parameters.required).toEqual(["queries"]);
    expect(WEB_SEARCH_TOOL.function.parameters.properties.queries.type).toBe("array");
  });

  it("includes a system guard string", () => {
    expect(TOOL_SYSTEM_GUARD).toMatch(/external data/i);
    expect(TOOL_USE_INSTRUCTION).toMatch(/web_search/i);
  });
});
