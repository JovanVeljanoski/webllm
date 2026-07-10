import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer } from "../lib/debounce.js";

describe("createDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces per key independently", () => {
    const debounce = createDebouncer();
    const a = vi.fn();
    const b = vi.fn();

    debounce("a", a, 100);
    debounce("b", b, 100);
    debounce("a", a, 100);

    vi.advanceTimersByTime(99);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("cancels pending call when the same key fires again", () => {
    const debounce = createDebouncer();
    const fn = vi.fn();

    debounce("x", fn, 50);
    vi.advanceTimersByTime(40);
    debounce("x", fn, 50);
    vi.advanceTimersByTime(49);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
