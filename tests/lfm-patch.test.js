import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const BUNDLE = path.join(process.cwd(), "lfm2_5.js");

describe("lfm2_5.js tool patch", () => {
  const source = fs.readFileSync(BUNDLE, "utf8");

  it("can preserve native tool-call control tokens", () => {
    expect(source).toContain("m=!t.preserveControlTokens");
    expect(source).toContain("skip_special_tokens:m");
    expect(source).toContain("rawText:p");
  });

  it("does not preserve control tokens unless requested", () => {
    expect(source).toContain("let m=!t.preserveControlTokens");
  });
});
