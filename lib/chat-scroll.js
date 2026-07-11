/** @typedef {{ scrollTop: number, scrollHeight: number, clientHeight: number }} ScrollMetrics */

export const CHAT_SCROLL_PIN_THRESHOLD_PX = 80;

/**
 * @param {ScrollMetrics} el
 * @param {number} [thresholdPx]
 */
export function isPinnedToBottom(el, thresholdPx = CHAT_SCROLL_PIN_THRESHOLD_PX) {
  if (!el || el.clientHeight <= 0) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

/**
 * @param {ScrollMetrics & { scrollTop: number }} el
 * @param {{ force?: boolean, thresholdPx?: number }} [opts]
 */
export function scrollToBottomIfPinned(el, { force = false, thresholdPx = CHAT_SCROLL_PIN_THRESHOLD_PX } = {}) {
  if (!el) return;
  if (force || isPinnedToBottom(el, thresholdPx)) {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  }
}
