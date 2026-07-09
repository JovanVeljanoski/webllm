import { describe, expect, it } from "vitest";
import { detectBrowser } from "../lib/browser.js";

describe("detectBrowser", () => {
  it("classifies common user agents", () => {
    expect(detectBrowser("Mozilla/5.0 Chrome/120.0.0.0")).toBe("chrome");
    expect(detectBrowser("Mozilla/5.0 Edg/120.0.0.0")).toBe("edge");
    expect(detectBrowser("Mozilla/5.0 Firefox/128.0")).toBe("firefox");
    expect(detectBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"))
      .toBe("safari");
    expect(detectBrowser("CustomBot/1.0")).toBe("other");
  });
});
