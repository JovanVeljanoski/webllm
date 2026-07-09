/** @file String, number, and time formatting helpers. */

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtBytes(b) {
  const u = ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 3 ? 2 : (v >= 10 || i === 0 ? 0 : 1))} ${u[i]}`;
}

export function formatTime(ts, now = new Date()) {
  const d = new Date(ts);
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatStreamStats({ tokCount, tps, ttft, prefix = "" } = {}) {
  const parts = [];
  if (Number.isFinite(tokCount) && tokCount > 0) parts.push(`${tokCount} tok`);
  if (Number.isFinite(tps) && tps > 0) parts.push(`${tps} tok/s`);
  if (ttft != null && ttft !== "") parts.push(`TTFT ${ttft}s`);
  const core = parts.join(" · ");
  if (!core) return prefix || "…";
  return prefix ? `${prefix} · ${core}` : core;
}

export function thinkLabel(meta, thinking) {
  if (meta?.ttft) return `Thought for ${meta.ttft}s`;
  if (meta?.tokens) return `Show thinking · ${meta.tokens} tok`;
  if (thinking) return "Show thinking";
  return "Thinking…";
}

export function statsLine(meta) {
  if (!meta) return "";
  return `${meta.tokens} tok · ${meta.tps} tok/s · TTFT ${meta.ttft}s`;
}

export function sessionDownloadFilename(title) {
  const slug = (title || "conversation").trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  return `${slug || "conversation"}.json`;
}
