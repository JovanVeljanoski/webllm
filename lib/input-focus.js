/** @file Composer focus behavior shared by conversation actions. */

export function focusComposerInput(input) {
  if (!input || input.disabled) return false;
  input.focus();
  return true;
}
