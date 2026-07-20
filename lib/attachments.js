/** @file Validate and normalize user-selected text attachments. */

export const MAX_FILE_BYTES = 1_048_576;
export const MAX_WORKSPACE_BYTES = 5 * 1_048_576;
export const MAX_WORKSPACE_FILES = 10;

const CATEGORY_EXTENSIONS = Object.freeze({
  plain_text: [".txt", ".log", ".md", ".markdown"],
  structured_text: [
    ".csv", ".tsv", ".json", ".jsonl", ".ndjson",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".xml",
  ],
  web_source: [
    ".html", ".htm", ".css", ".js", ".mjs", ".cjs",
    ".jsx", ".ts", ".tsx", ".vue", ".svelte",
  ],
});

export const SUPPORTED_FILE_EXTENSIONS = Object.freeze(
  Object.values(CATEGORY_EXTENSIONS).flat(),
);

const EXTENSION_CATEGORIES = new Map(
  Object.entries(CATEGORY_EXTENSIONS)
    .flatMap(([category, extensions]) => extensions.map(extension => [extension, category])),
);

const MIME_BY_EXTENSION = Object.freeze({
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".ndjson": "application/x-ndjson",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/jsx",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".vue": "text/plain",
  ".svelte": "text/plain",
});

const BINARY_SIGNATURES = [
  [0x25, 0x50, 0x44, 0x46], // PDF
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x50, 0x4b, 0x03, 0x04], // ZIP and Office containers
  [0x1f, 0x8b], // gzip
  [0x37, 0x7a, 0xbc, 0xaf], // 7z
];

export class AttachmentValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AttachmentValidationError";
    this.code = code;
  }
}

export function fileExtension(name) {
  const normalized = String(name || "").trim();
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) return "";
  return normalized.slice(dot).toLowerCase();
}

export function attachmentCategory(name) {
  return EXTENSION_CATEGORIES.get(fileExtension(name)) || null;
}

export function isSupportedAttachmentName(name) {
  return attachmentCategory(name) !== null;
}

export function acceptedFileInputValue() {
  return SUPPORTED_FILE_EXTENSIONS.join(",");
}

export function workspaceUsage(attachments = []) {
  return {
    count: attachments.length,
    bytes: attachments.reduce(
      (sum, attachment) => sum + Math.max(
        0,
        Number(attachment?.storedBytes ?? attachment?.originalBytes) || 0,
      ),
      0,
    ),
  };
}

export function validateAttachmentCandidate(file, attachments = []) {
  const name = String(file?.name || "").trim();
  if (!name) {
    throw new AttachmentValidationError("missing_name", "The selected file has no name.");
  }
  const extension = fileExtension(name);
  if (!extension || !EXTENSION_CATEGORIES.has(extension)) {
    throw new AttachmentValidationError(
      "unsupported_type",
      `${name} was not added: ${extension || "extensionless files"} are not supported in this version.`,
    );
  }

  const size = Number(file?.size);
  if (!Number.isFinite(size) || size < 0) {
    throw new AttachmentValidationError(
      "invalid_size",
      `${name} was not added: its size could not be determined.`,
    );
  }
  if (size > MAX_FILE_BYTES) {
    throw new AttachmentValidationError(
      "file_too_large",
      `${name} was not added: files must be 1 MB or smaller.`,
    );
  }

  const usage = workspaceUsage(attachments);
  if (usage.count >= MAX_WORKSPACE_FILES) {
    throw new AttachmentValidationError(
      "too_many_files",
      `${name} was not added: a conversation can contain at most ${MAX_WORKSPACE_FILES} files.`,
    );
  }
  return {
    name,
    extension,
    category: EXTENSION_CATEGORIES.get(extension),
    size,
  };
}

export function sanitizeVirtualFilename(name) {
  const cleaned = String(name || "")
    .replace(/[\\/]/g, "_")
    .split("")
    .filter(char => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  return cleaned || "file.txt";
}

export function createVirtualPath(name, attachments = []) {
  const safe = sanitizeVirtualFilename(name);
  const extension = fileExtension(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  const occupied = new Set(
    attachments.map(item => String(item?.virtualPath || "").toLocaleLowerCase()),
  );
  if (!occupied.has(safe.toLocaleLowerCase())) return safe;

  let suffix = 2;
  while (occupied.has(`${stem} (${suffix})${extension}`.toLocaleLowerCase())) suffix++;
  return `${stem} (${suffix})${extension}`;
}

function startsWithBytes(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function hasBinarySignature(bytes) {
  return BINARY_SIGNATURES.some(signature => startsWithBytes(bytes, signature));
}

function decodeUtf16(bytes, littleEndian) {
  if ((bytes.length - 2) % 2 !== 0) {
    throw new AttachmentValidationError(
      "invalid_encoding",
      "The file has an incomplete UTF-16 code unit.",
    );
  }
  try {
    return new TextDecoder(littleEndian ? "utf-16le" : "utf-16be", { fatal: true })
      .decode(bytes.subarray(2));
  } catch {
    throw new AttachmentValidationError(
      "invalid_encoding",
      "The file is not valid BOM-tagged UTF-16 text.",
    );
  }
}

export function decodeAttachmentBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (hasBinarySignature(bytes)) {
    throw new AttachmentValidationError(
      "binary_content",
      "The file content is binary and cannot be added as text.",
    );
  }

  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = decodeUtf16(bytes, true);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = decodeUtf16(bytes, false);
  } else {
    if (bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) {
      throw new AttachmentValidationError(
        "binary_content",
        "The file contains NUL bytes and cannot be added as UTF-8 text.",
      );
    }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AttachmentValidationError(
        "invalid_encoding",
        "The file is not valid UTF-8 or BOM-tagged UTF-16 text.",
      );
    }
  }

  const sample = text.slice(0, 4096);
  let controls = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    const allowedWhitespace = code === 9 || code === 10 || code === 12 || code === 13;
    if (!allowedWhitespace && (code < 32 || code === 127)) controls++;
  }
  if (sample.length && controls / sample.length > 0.1) {
    throw new AttachmentValidationError(
      "binary_content",
      "The file contains too many control characters to be treated as text.",
    );
  }

  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export async function ingestAttachmentFile(file, {
  sessionId,
  attachments = [],
  id = globalThis.crypto?.randomUUID?.()
    || `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  now = Date.now(),
} = {}) {
  if (!sessionId) throw new TypeError("sessionId is required");
  const validated = validateAttachmentCandidate(file, attachments);
  const buffer = await file.arrayBuffer();
  const content = decodeAttachmentBytes(buffer);
  const storedBytes = new TextEncoder().encode(content).byteLength;
  if (storedBytes > MAX_FILE_BYTES) {
    throw new AttachmentValidationError(
      "normalized_file_too_large",
      `${validated.name} was not added: normalized text exceeds the 1 MB limit.`,
    );
  }
  const usage = workspaceUsage(attachments);
  if (usage.bytes + storedBytes > MAX_WORKSPACE_BYTES) {
    throw new AttachmentValidationError(
      "workspace_too_large",
      `${validated.name} was not added: stored text can total at most 5 MB per conversation.`,
    );
  }

  return {
    id,
    sessionId: String(sessionId),
    virtualPath: createVirtualPath(validated.name, attachments),
    originalName: validated.name,
    extension: validated.extension,
    mime: MIME_BY_EXTENSION[validated.extension] || String(file.type || "text/plain"),
    category: validated.category,
    originalBytes: validated.size,
    storedBytes,
    lastModified: Number(file.lastModified) || 0,
    content,
    lineCount: content.split("\n").length,
    createdAt: Number(now) || Date.now(),
  };
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
