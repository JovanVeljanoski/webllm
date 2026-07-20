import { describe, expect, it } from "vitest";
import {
  EXTERNAL_TOOL_DATA_GUARD,
  GREP_TOOL,
  GREP_TOOL_SPEC,
  LOCAL_FILE_DATA_GUARD,
  READ_TOOL,
  READ_TOOL_SPEC,
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

describe("local file tool specs", () => {
  it("defines strict read and regex-with-literal-fallback grep schemas", () => {
    expect(READ_TOOL_SPEC.schema).toBe(READ_TOOL);
    expect(READ_TOOL.function.parameters.required).toEqual(["path"]);
    expect(READ_TOOL.function.parameters.properties.limit.maximum).toBe(400);
    expect(GREP_TOOL_SPEC.schema).toBe(GREP_TOOL);
    expect(GREP_TOOL.function.parameters.required).toEqual(["pattern"]);
    expect(GREP_TOOL.function.description).toContain("regular expression");
    expect(GREP_TOOL.function.parameters.properties.literal)
      .toMatchObject({ type: "boolean" });
  });

  it("marks uploaded content as untrusted local data", () => {
    expect(LOCAL_FILE_DATA_GUARD).toContain("untrusted data");
    expect(READ_TOOL_SPEC.resultTrust).toBe("untrusted");
    expect(GREP_TOOL_SPEC.resultTrust).toBe("untrusted");
  });
});
