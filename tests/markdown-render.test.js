import { describe, expect, it } from "vitest";
import { configureMarkdownParser, renderMarkdownHtml } from "../lib/markdown-render.js";

describe("renderMarkdownHtml", () => {
  it("falls back to paragraph rendering without a parser", () => {
    configureMarkdownParser(null);
    expect(renderMarkdownHtml("Hello **world**")).toContain("<strong>world</strong>");
    expect(renderMarkdownHtml("Line one\n\nLine two")).toContain("<p>Line one</p>");
  });

  it("escapes raw HTML in fallback mode", () => {
    configureMarkdownParser(null);
    expect(renderMarkdownHtml("<script>alert(1)</script>")).not.toContain("<script");
  });
});
