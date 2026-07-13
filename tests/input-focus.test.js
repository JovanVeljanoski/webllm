import { describe, expect, it, vi } from "vitest";
import { focusComposerInput } from "../lib/input-focus.js";

describe("focusComposerInput", () => {
  it("focuses an enabled composer input", () => {
    const input = { disabled: false, focus: vi.fn() };

    expect(focusComposerInput(input)).toBe(true);
    expect(input.focus).toHaveBeenCalledOnce();
  });

  it("does not focus missing or disabled inputs", () => {
    const input = { disabled: true, focus: vi.fn() };

    expect(focusComposerInput(input)).toBe(false);
    expect(focusComposerInput(null)).toBe(false);
    expect(input.focus).not.toHaveBeenCalled();
  });
});
