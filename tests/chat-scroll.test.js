import { describe, expect, it } from "vitest";
import { isPinnedToBottom, scrollToBottomIfPinned } from "../lib/chat-scroll.js";

describe("chat-scroll", () => {
  it("detects pinned vs scrolled-up state", () => {
    expect(isPinnedToBottom({ scrollTop: 920, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isPinnedToBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });

  it("scrolls only when pinned or forced", () => {
    const el = { scrollTop: 800, scrollHeight: 1000, clientHeight: 100 };
    scrollToBottomIfPinned(el);
    expect(el.scrollTop).toBe(800);

    el.scrollTop = 920;
    scrollToBottomIfPinned(el);
    expect(el.scrollTop).toBe(900);

    el.scrollTop = 800;
    scrollToBottomIfPinned(el, { force: true });
    expect(el.scrollTop).toBe(900);
  });
});
