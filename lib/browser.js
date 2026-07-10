/** @file Browser detection (UA parsing). */

export function detectBrowser(userAgent = "") {
  const ua = userAgent || "";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Edg\//i.test(ua)) return "edge";
  if (/Chrome\//i.test(ua) || /CriOS/i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  return "other";
}
