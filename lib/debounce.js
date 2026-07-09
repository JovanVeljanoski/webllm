/** @file Per-key debounce utility. */

export function createDebouncer() {
  const timers = new Map();
  return function debounce(key, fn, delay = 350) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      fn();
    }, delay));
  };
}
