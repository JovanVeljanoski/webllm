import { describe, expect, it } from "vitest";
import {
  EXTERNAL_TOOL_DATA_GUARD,
  WEB_SEARCH_RESULT_POLICY,
  WEB_SEARCH_TOOL,
  WEB_SEARCH_TOOL_SPEC,
  WEB_SEARCH_USE_POLICY,
} from "../lib/tools.js";

describe("WEB_SEARCH_TOOL_SPEC", () => {
  it("defines a single web_search function tool", () => {
    expect(WEB_SEARCH_TOOL_SPEC.schema).toBe(WEB_SEARCH_TOOL);
    expect(WEB_SEARCH_TOOL.function.name).toBe("web_search");
    expect(WEB_SEARCH_TOOL.function.parameters.additionalProperties).toBe(false);
    expect(WEB_SEARCH_TOOL.function.parameters.required).toEqual(["queries"]);
    expect(WEB_SEARCH_TOOL.function.parameters.properties.queries.type).toBe("array");
    expect(WEB_SEARCH_TOOL.function.parameters.properties.queries.description)
      .toContain("about 5–15 keywords each");
  });

  it("keeps search-specific and external-data policies on the tool spec", () => {
    expect(EXTERNAL_TOOL_DATA_GUARD).toMatch(/external data/i);
    expect(WEB_SEARCH_USE_POLICY).toMatch(/web_search/i);
    expect(WEB_SEARCH_RESULT_POLICY).toMatch(/summarize/i);
    expect(WEB_SEARCH_TOOL_SPEC.promptPolicy).toEqual([
      WEB_SEARCH_USE_POLICY,
      WEB_SEARCH_RESULT_POLICY,
    ]);
  });
});
