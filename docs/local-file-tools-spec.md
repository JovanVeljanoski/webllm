# Local file tools

This document describes the current read-only local file workspace, its behavior,
and the reasons behind the important constraints.

## Scope

Each conversation has a private virtual workspace containing text files selected
by the user. The model can inspect that workspace through:

- bounded excerpts from explicitly selected file references;
- `read` for numbered line ranges;
- `grep` for regex or literal search.

The browser never receives arbitrary filesystem access, operating-system paths,
persistent file handles, shell access, or file mutation tools. PDF, images,
Office documents, archives, semantic search, `glob`, `find`, and `ls` are not part
of the current feature.

The workspace is deliberately limited to ten files. At this scale a metadata
manifest plus bounded linear search is simpler and more predictable than an
index, embedding model, or directory-discovery tools.

## Accepted files and limits

Supported extensions:

- plain text: `.txt`, `.log`, `.md`, `.markdown`;
- structured text: `.csv`, `.tsv`, `.json`, `.jsonl`, `.ndjson`, `.yaml`,
  `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.xml`;
- web source: `.html`, `.htm`, `.css`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`,
  `.tsx`, `.vue`, `.svelte`.

Limits:

- at most 10 files per conversation;
- at most 1,048,576 original bytes per selected file;
- at most 1,048,576 normalized stored bytes per file;
- at most 5,242,880 normalized stored bytes across one conversation.

The original per-file cap is checked before decoding so the browser never reads
an unexpectedly large input. The aggregate quota uses `storedBytes`, because
normalized UTF-8 text is what IndexedDB actually retains. Legacy attachment
records without `storedBytes` fall back to `originalBytes`.

Files must decode as UTF-8 or BOM-tagged UTF-16. Ingestion rejects known binary
signatures, NUL bytes, invalid text encodings, and excessive control characters.
It strips a leading BOM and normalizes CRLF and CR line endings to LF without
adding a synthetic final newline.

## Virtual workspace and filenames

An attachment record contains:

```js
{
  id,
  sessionId,
  virtualPath,
  originalName,
  extension,
  mime,
  category,
  originalBytes,
  storedBytes,
  lastModified,
  content,
  lineCount,
  createdAt
}
```

The stable attachment ID is the durable identity. The virtual path is a
conversation-local display and tool identifier.

Virtual paths:

- use the selected basename;
- replace `/` and `\` with `_`;
- remove operating-system control characters;
- resolve collisions case-insensitively with ` (2)`, ` (3)`, and so on.

Printable model-token-like filename text is intentionally preserved. This keeps
the visible filename faithful to the user's selection. File content and tool
results are sanitized separately before entering model context.

## File references

References are explicit metadata, not an interpretation of arbitrary text.

A file becomes referenced only when the user:

- selects it from `@file` autocomplete; or
- clicks its row in the Files workspace.

Uploading a file never references it automatically. Merely typing a complete
`@filename` without selecting a suggestion remains plain text and does not create
`fileRefs`.

Selecting a file:

1. inserts `@virtualPath` into the visible text;
2. adds its stable ID to the draft's selected-reference set;
3. displays a removable chip.

Removing a chip removes the stable ID but leaves the visible text unchanged.
Because selected IDs are authoritative, the remaining text cannot silently
reattach the file.

Deleting the complete mention from the text also removes the selected ID. The
mention parser is used only to reconcile already-selected references; it never
creates a reference from free text.

### Mention parsing

The parser returns structured, non-overlapping spans:

```js
findFileMentions(text, attachments)
// [{ id, virtualPath, start, end }]
```

It:

- requires start-of-text, whitespace, or opening punctuation before `@`;
- rejects email and identifier forms such as `person@notes.md`;
- compares virtual paths case-insensitively;
- tests longer filenames first;
- does not match `foo.js` inside `@foo.js.txt`;
- accepts sentence punctuation after a complete filename;
- supports spaces, parentheses, collision suffixes, and Unicode.

### Tool-gated reference behavior

References are available only when at least one local extraction tool, `read` or
`grep`, is enabled and otherwise eligible. A model does not need to be loaded to
prepare a referenced draft, but the selected model must support tools and grammar
mode must be off.

When both local tools are disabled:

- workspace reference buttons and `@file` autocomplete are disabled;
- the current draft has no active references;
- new messages do not persist `fileRefs`;
- historical `fileRefs` remain stored but render as inactive;
- historical references are not expanded into model context.

Persisting historical IDs makes the preference reversible: re-enabling a local
tool restores those references without rewriting conversation history.

### Historical editing

The historical user-message editor has its own selected-reference set, chips, and
`@file` autocomplete.

- It starts from that message's persisted `fileRefs`.
- Selecting autocomplete adds a new stable ID.
- Removing a chip removes that ID.
- Deleting a mention removes its selected ID.
- Saving commits exactly the editor's selected-reference set.

The editor never reparses all visible `@filename` text into new references.
Therefore an unrelated text edit cannot reattach a previously dismissed file.

## Session model

User messages may contain:

```js
{
  role: "user",
  content: "Compare @notes.md with @data.json.",
  fileRefs: ["attachment-a", "attachment-b"]
}
```

`fileRefs` are unique strings in selection order and are omitted when empty.
Expanded file content is never written into the canonical conversation
transcript.

Per-conversation tool preferences use:

```js
toolPreferences: {
  read: true,
  grep: true,
  web_search: false
}
```

## Model context

When local references are enabled, each referenced user message receives a
synthetic, line-numbered excerpt immediately before generation. The durable
message remains unchanged.

The combined excerpt budgets are:

- Gemma 4 E2B: 8 KB;
- Bonsai 27B: 1 KB;
- LFM2.5 230M: 4 KB;
- LFM2.5 350M: 4 KB.

Multiple referenced files share the budget evenly. Each block contains a complete
file when it fits, or the largest complete-line prefix plus a `read` continuation
hint. Missing and deleted attachment IDs are ignored.

When local file tools are active, their prompt policy also includes a
metadata-only manifest:

```text
Files available in this conversation:
- notes.md — Text, 184 lines, 12.4 KB
- data.json — Structured text, 92 lines, 38.1 KB

Use grep to search these files and read to inspect relevant line ranges.
```

The manifest never contains file content.

The loaded model's tokenizer performs the final context-window check. Fitting
removes complete oldest turns and never splits an assistant tool call from its
tool result. The current turn is never silently shortened. If it cannot fit, the
UI reports the required and available input-token counts.

## Model-specific budgets

File budgets live with model capabilities in `lib/models.js`:

```js
localFiles: {
  excerptBytes,
  readLines,
  readBytes,
  grepMatches,
  grepBytes
}
```

Unknown future models receive conservative fallback limits until they declare
their own values.

Current tool-result limits:

- Gemma 4 E2B: 100 default read lines, 24 KB read output, 50 grep matches,
  12 KB grep output;
- Bonsai 27B: 100 lines, 4 KB read output, 10 matches, 3 KB grep output;
- LFM2.5 230M and 350M: 160 lines, 8 KB read output, 20 matches,
  6 KB grep output.

Bonsai's limits are intentionally small because its declared context window is
4,096 tokens. LFM's nominal context size does not imply reliable synthesis over
large evidence blocks, so its results also remain compact.

## `read`

`read` accepts:

- `path`: exact virtual path;
- `offset`: 1-based first line, default 1;
- `limit`: requested line count, bounded to 1–400.

It returns complete numbered lines, actual range metadata, total lines, result
bytes, and `nextOffset` when more content remains. A single line that exceeds the
byte budget is UTF-8-truncated with an explicit marker.

As a compatibility concession for weaker local models, a one-file workspace
accepts an omitted path, common path aliases such as `filename`, or an
unresolvable supplied path. The result records `pathInferred: true`. Multiple-file
workspaces require an unambiguous path.

Duplicate successful requests for the same file, offset, and limit are skipped
within one turn.

## `grep`

`grep` searches filenames and individual lines. It accepts:

- `pattern`: a JavaScript regular expression by default;
- `literal: true`: exact substring search instead of regex;
- `path`: optional exact file restriction;
- `include`: optional `*.ext` or `*.{ext1,ext2}` filter;
- `ignore_case`: default true;
- `context`: 0–3 surrounding lines;
- `limit`: bounded to 1–50 matches.

Results contain virtual paths, line numbers, bounded line text, optional context,
truncation metadata, and refinement guidance.

Literal scans yield periodically on the main thread and honor abort signals.
Regex scans run in a fresh module worker. The host terminates the worker after
success, error, abort, or 1,000 ms. This permits normal JavaScript regex syntax
without allowing catastrophic backtracking to block the UI. Invalid or timed-out
regexes produce actionable errors and never silently fall back to literal mode.

Duplicate searches include pattern, path, include filter, case mode, regex versus
literal mode, context, and limit in their identity.

## Tool availability

`lib/tool-registry.js` owns declarative descriptors for `read`, `grep`, and
`web_search`. Each descriptor states:

- tool ID and scope;
- whether attachments are required;
- whether it conflicts with grammar mode.

`resolveToolAvailability()` is the shared source for:

- preferred state;
- eligibility;
- active runtime state;
- disabled reason;
- grammar conflicts;
- local-reference availability.

The app uses this resolution for agent-mode selection, tool construction, grammar
gating, toggle state, reference controls, execution metadata, and diagnostic
exports. Adding a future tool starts with one descriptor and factory rather than
new independent gating logic.

Grammar guidance and tools remain mutually exclusive. Uploading the first accepted
file enables `read` and `grep` for that conversation and turns grammar mode off.
Users may disable either tool afterward.

## Agent loop and trust boundaries

The generic agent loop allows:

- at most three tool rounds;
- at most four calls from one generation;
- at most eight calls in one user turn;
- one final tools-disabled generation after the round limit.

Tool policy is rebuilt before every generation. The final tools-disabled
generation receives neither stale schemas nor stale use-policy text.

File excerpts and local tool results pass through the local untrusted-data
sanitizer. It removes native Gemma, LFM, and Bonsai control boundaries and XML
tool-call tags. Prompt policy tells the model to treat uploaded content as
evidence rather than instructions.

If Web Search is enabled, model-generated search queries are sent to Exa. Local
tools themselves never send file data over the network. There is no automatic
data-loss-prevention layer between local evidence and model-generated web
queries; the Web Search privacy warning therefore remains important.

## Persistence and deletion

IndexedDB version 2 contains:

- `sessions`, keyed by session ID;
- `attachments`, keyed by attachment ID and indexed by `sessionId`.

File content is stored once in the attachment record. Deleting a conversation
deletes its session and attachments in one transaction. Startup cleanup removes
attachment records whose session no longer exists.

When IndexedDB is unavailable, sessions and files continue in memory for the
current page where possible.

## Exports and diagnostics

The default OpenAI-compatible export contains portable conversation messages. It
does not include `fileRefs` metadata, expand references, or bundle attachment
content.

The diagnostic format is version 3 and always declares provenance:

- `exact_runtime_capture`: requests captured immediately after context fitting and
  immediately before model generation;
- `reconstructed_current_context`: context rebuilt from current session state
  because an exact capture is no longer available.

Exact captures include every model request in the latest in-memory turn, including
runtime-specific messages, active schemas, generation number, and output limit.
They are held in memory rather than persisted, avoiding permanent duplication of
large prompts. After a reload, export falls back to a clearly labelled
reconstruction.

The download dialog warns that diagnostics may contain bounded referenced-file
excerpts. Neither export format includes complete attachment records, raw `File`
objects, or unrelated browser storage.

## Extension rules

To add a model:

1. register its runtime and context window in `lib/models.js`;
2. declare `localFiles` budgets or accept conservative defaults;
3. ensure its adapter reports exact prepared requests through
   `onRequestPrepared`;
4. run the file-tool smoke scenarios with the real model.

To add an extractive tool:

1. add its schema and prompt/trust policy;
2. implement a bounded conversation-scoped factory;
3. add a declarative tool descriptor;
4. expose a per-session preference control;
5. test mixed calls, aborts, output limits, and final tools-disabled behavior.

## Required verification

Automated coverage includes:

- supported types, encoding, binary rejection, and normalized stored-byte quotas;
- collision-safe virtual paths;
- explicit reference selection and removal;
- email, prefix, punctuation, Unicode, and collision-suffix mention boundaries;
- historical reference replacement without implicit reattachment;
- manifest and excerpt budgets;
- `read` ranges, inference fallback, continuation, and byte bounds;
- regex/literal grep, filters, deadlines, aborts, and deduplication;
- declarative availability and grammar conflicts;
- session migration and attachment cascade deletion;
- exact versus reconstructed diagnostic provenance;
- Gemma, Bonsai, and LFM parser/tool-call compatibility.

Browser smoke testing covers IndexedDB reload, conversation switching, composer and
historical `@file` selection, disabling both local tools, regex timeout behavior,
context-overflow messaging, and exact versus reconstructed diagnostic downloads.
