/** @file Markdown → safe HTML for assistant responses. */

/** @type {{ parse: (src: string) => string } | null} */
let parser = null;

/** @param {{ parse: (src: string) => string }} marked */
export function configureMarkdownParser(marked) {
  parser = marked;
}

/** @param {string} html */
export function sanitizeMarkdownHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach((el) => {
    el.remove();
  });
  tpl.content.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on")
        || ((name === "href" || name === "src") && /^\s*(javascript|data):/i.test(attr.value))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return tpl.innerHTML;
}

/** @param {string} text */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} text */
function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

/** @param {string} text */
function fallbackMarkdownHtml(text) {
  const safe = escapeHtml(text || "");
  const paragraphs = safe.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((p) => `<p>${formatInline(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** @param {string} text */
export function renderMarkdownHtml(text) {
  const raw = text || "";
  if (parser) {
    try {
      return sanitizeMarkdownHtml(parser.parse(raw));
    } catch {
      /* fall through */
    }
  }
  return fallbackMarkdownHtml(raw);
}
