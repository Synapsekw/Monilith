/**
 * Pure Markdown core for board `text` cells.
 *
 * This module imports no UI framework and has no DOM dependency — it is
 * plain, synchronous TypeScript so it can be unit-tested without a DOM and
 * reused by any renderer, present or future. It is the single place
 * Markdown behaviour for text cells is defined:
 *
 * - `stripMarkdown`  — collapsed-cell preview text (marks stripped).
 * - `applyMarkdown`  — toolbar actions on a `<textarea>` selection.
 * - `parseMarkdown`  — expanded-cell preview AST.
 *
 * `stripMarkdown` runs once per VISIBLE text cell on every board render
 * (hundreds of cells on a large board), so its fast path — bailing out
 * before the Markdown-specific replace passes when the input has no
 * Markdown syntax at all — is a real performance requirement. Do not
 * remove it, and do not build `stripMarkdown` on top of `parseMarkdown`
 * (that would make every cell pay for full block/inline parsing just to
 * render a plain preview).
 */

import { isHttpUrl } from "@/lib/validations/boards";

export type MarkdownAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "heading"
  | "bulletList"
  | "numberedList"
  | "link"
  | "inlineCode"
  | "quote";

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "strikethrough"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "quote"; children: Inline[] }
  | { type: "bulletList"; items: Inline[][] }
  | { type: "numberedList"; items: Inline[][] };

export type Selection = { text: string; selStart: number; selEnd: number };

// ---------------------------------------------------------------------------
// stripMarkdown
// ---------------------------------------------------------------------------

// Matches any character that could plausibly be part of Markdown syntax this
// module understands. If none of these appear, the string cannot contain any
// markup we'd strip, so we can return it untouched without running any of
// the (comparatively expensive) replace passes below.
const MARKDOWN_SNIFF = /[*_~`>[\]#\n-]/;
// A numbered-list line ("1. item") uses only digits and a dot, none of which
// the sniff above catches, so it needs its own cheap pre-check.
const NUMBERED_LIST_SNIFF = /^\d+\.\s/m;

const LINE_PREFIX_RE = /^(?:#{1,3}[ \t]+|[-*][ \t]+|\d+\.[ \t]+|>[ \t]+)/gm;
// Lazy match up to the NEAREST closing `**`, not `[^*]+` (no asterisks at
// all) — the same fix `parseBold` already needed (see its comment below).
// `[^*]+` cannot span content that itself contains `*` for nested italic
// (`**bold *italic* text**`), so it never matches at all and the whole
// bold span — including its nested emphasis markers — falls straight
// through to the collapsed cell unstripped. `stripMarkdown` and
// `parseMarkdown` must agree on what is Markdown syntax; this keeps them
// in sync for nested emphasis the same way `isValidEmphasis` does for
// intraword delimiters.
const BOLD_RE = /\*\*((?:(?!\*\*)[\s\S])+?)\*\*/g;
const STRIKE_RE = /~~([^~]+)~~/g;
const CODE_RE = /`([^`]+)`/g;
// Italic: single `*` or `_` around non-empty, non-`*`/`_` content. Validity
// (word-boundary + no-adjacent-whitespace) is enforced separately by
// `isValidEmphasis` below — this regex only finds *candidate* pairs.
const ITALIC_RE = /(?:\*([^*]+)\*|_([^_]+)_)/g;
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

// CommonMark-ish emphasis rule, applied to both `stripMarkdown` and
// `parseMarkdown` so a stored plain-text value (never intended as Markdown)
// never gets its `_`/`*` characters silently eaten:
//
// - Not flanked by a word character on the outside (rules out intraword
//   delimiters like the underscores in `user_id`, `prod_db_2`,
//   `snake_case_name.txt`).
// - No whitespace touching the marker on the inside (rules out false
//   positives like `5 * 3 = 15 * 2`, where the marker is followed/preceded
//   by a space rather than the emphasised text).
//
// `full`/`start`/`end` are the string being matched against and the
// candidate match's `[start, end)` span within it; `content` is the text
// between the delimiters.
function isValidEmphasis(
  full: string,
  start: number,
  end: number,
  content: string,
): boolean {
  if (content.length === 0) return false;
  if (isWordChar(full[start - 1]) || isWordChar(full[end])) return false;
  if (/^\s/.test(content) || /\s$/.test(content)) return false;
  return true;
}

export function stripMarkdown(md: string): string {
  let out = md;

  if (MARKDOWN_SNIFF.test(md) || NUMBERED_LIST_SNIFF.test(md)) {
    out = out
      .replace(LINE_PREFIX_RE, "")
      .replace(LINK_RE, "$1")
      .replace(CODE_RE, "$1")
      .replace(BOLD_RE, "$1")
      .replace(STRIKE_RE, "$1")
      .replace(
        ITALIC_RE,
        (
          m: string,
          star: string | undefined,
          underscore: string | undefined,
          offset: number,
          str: string,
        ) => {
          const content = star ?? underscore ?? "";
          return isValidEmphasis(str, offset, offset + m.length, content)
            ? content
            : m;
        },
      )
      .replace(/\n/g, " ");
  }

  // Always normalised, on both the fast path (no Markdown syntax detected)
  // and the full-strip path above, so the same visible content produces the
  // same output regardless of which path ran.
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// previewMarkdown
// ---------------------------------------------------------------------------

/**
 * Strip Markdown, then bound the result to `maxChars` (code points, not UTF-16
 * code units — see below) with a trailing "…" when it was cut. The single,
 * shared implementation for every "syntax-free preview of a text cell"
 * surface: `src/lib/collaboration/activity.ts`, `src/lib/reports/shape.ts`,
 * `src/lib/dashboards/list-rows.ts`, and `src/lib/ai/column-fill/actions.ts`
 * each previously reimplemented this (strip → slice → maybe "…") with their
 * own budget. Route new call sites through this instead of copying the
 * pattern again — keep only the budget as a named constant at the call site,
 * since that legitimately varies per surface.
 *
 * Slicing is code-point-aware (`Array.from`, which iterates by Unicode code
 * point) rather than a plain `string.slice`, which indexes by UTF-16 code
 * unit: a naive `slice(0, maxChars)` can land inside an astral character's
 * surrogate pair (e.g. an emoji) and leave a lone, unpaired surrogate at the
 * cut — "�" (the replacement character) or a broken glyph — instead of
 * cutting cleanly before or after it.
 */
export function previewMarkdown(text: string, maxChars: number): string {
  const stripped = stripMarkdown(text);
  const codePoints = Array.from(stripped);
  if (codePoints.length <= maxChars) return stripped;
  return `${codePoints.slice(0, maxChars).join("").trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// applyMarkdown
// ---------------------------------------------------------------------------

const WRAP_MARKS: Record<
  "bold" | "italic" | "strikethrough" | "inlineCode",
  string
> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  inlineCode: "`",
};

const LINE_PREFIXES: Record<"heading" | "bulletList" | "quote", string> = {
  heading: "### ",
  bulletList: "- ",
  quote: "> ",
};

// Matches a leading numbered-list marker, e.g. "12. ".
const NUMBERED_PREFIX_RE = /^\d+\.\s/;
// Matches a leading heading marker of any supported level, e.g. "## ".
const HEADING_PREFIX_RE = /^#{1,3}\s/;
// Matches a leading bullet marker.
const BULLET_PREFIX_RE = /^-\s/;
// Matches a leading quote marker.
const QUOTE_PREFIX_RE = /^>\s/;

// `before.endsWith(mark)` alone is ambiguous for the italic mark `*`: it
// also matches when `before` actually ends with a `**` (bold) pair, since
// `**` ends with `*`. That would make italic-toggling text already wrapped
// in `**bold**` strip one asterisk off the bold marker instead of nesting
// italic inside it. Guard the single-`*` case by requiring the boundary NOT
// be a doubled marker.
function endsWithLoneMark(s: string, mark: string): boolean {
  if (!s.endsWith(mark)) return false;
  if (mark === "*") return !s.endsWith("**");
  return true;
}
function startsWithLoneMark(s: string, mark: string): boolean {
  if (!s.startsWith(mark)) return false;
  if (mark === "*") return !s.startsWith("**");
  return true;
}

function applyWrap(
  text: string,
  selStart: number,
  selEnd: number,
  mark: string,
): Selection {
  const before = text.slice(0, selStart);
  const selected = text.slice(selStart, selEnd);
  const after = text.slice(selEnd);

  const hasBefore = endsWithLoneMark(before, mark);
  const hasAfter = startsWithLoneMark(after, mark);

  if (selected.length > 0 && hasBefore && hasAfter) {
    // Toggle off: remove the marks immediately outside the selection.
    const newBefore = before.slice(0, before.length - mark.length);
    const newAfter = after.slice(mark.length);
    return {
      text: newBefore + selected + newAfter,
      selStart: newBefore.length,
      selEnd: newBefore.length + selected.length,
    };
  }

  // Toggle on (including the empty-selection case: marks are inserted with
  // the caret placed between them).
  const newText = before + mark + selected + mark + after;
  return {
    text: newText,
    selStart: selStart + mark.length,
    selEnd: selStart + mark.length + selected.length,
  };
}

function linePrefixMatcher(
  action: "heading" | "bulletList" | "numberedList" | "quote",
): RegExp {
  switch (action) {
    case "heading":
      return HEADING_PREFIX_RE;
    case "bulletList":
      return BULLET_PREFIX_RE;
    case "numberedList":
      return NUMBERED_PREFIX_RE;
    case "quote":
      return QUOTE_PREFIX_RE;
  }
}

function applyLinePrefix(
  text: string,
  selStart: number,
  selEnd: number,
  action: "heading" | "bulletList" | "numberedList" | "quote",
): Selection {
  // Expand the selection to cover whole lines.
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const lineEndSearch = text.indexOf("\n", selEnd);
  const lineEnd = lineEndSearch === -1 ? text.length : lineEndSearch;

  const before = text.slice(0, lineStart);
  const after = text.slice(lineEnd);
  const selectedLinesText = text.slice(lineStart, lineEnd);
  const lines = selectedLinesText.split("\n");

  const matcher = linePrefixMatcher(action);
  const allPrefixed = lines.every((line) => matcher.test(line));

  let newLines: string[];
  if (allPrefixed) {
    // Toggle off.
    newLines = lines.map((line) => line.replace(matcher, ""));
  } else if (action === "numberedList") {
    // Toggle on with sequential numbering, replacing any existing prefix of
    // the same action first isn't needed since allPrefixed is false, but a
    // line may already carry a different prefix — line-prefix actions only
    // ever add one kind at a time per this spec, so we just prepend.
    newLines = lines.map((line, i) => `${i + 1}. ${line}`);
  } else {
    const prefix = LINE_PREFIXES[action];
    newLines = lines.map((line) => `${prefix}${line}`);
  }

  // Each line's prefix is inserted/removed at that line's own start, so the
  // caret/selection offsets need to track a per-line length delta rather
  // than snapping to the whole modified block: an offset picks up a line's
  // delta once it is at or past that line's start (the point where the
  // prefix change happens), and every earlier line's delta too.
  const lineStartOffsets: number[] = [];
  let cursor = lineStart;
  for (const line of lines) {
    lineStartOffsets.push(cursor);
    cursor += line.length + 1; // +1 for the joining "\n"
  }
  const deltas = lines.map((line, i) => newLines[i].length - line.length);
  const shiftAt = (offset: number): number => {
    let shift = 0;
    for (let i = 0; i < lineStartOffsets.length; i++) {
      if (lineStartOffsets[i] > offset) break;
      shift += deltas[i];
    }
    return shift;
  };

  const newSelectedLinesText = newLines.join("\n");
  const newText = before + newSelectedLinesText + after;

  return {
    text: newText,
    selStart: selStart + shiftAt(selStart),
    selEnd: selEnd + shiftAt(selEnd),
  };
}

function applyLink(text: string, selStart: number, selEnd: number): Selection {
  const before = text.slice(0, selStart);
  const selected = text.slice(selStart, selEnd);
  const after = text.slice(selEnd);

  if (selected.length === 0) {
    const label = "text";
    const url = "url";
    const inserted = `[${label}](${url})`;
    const newText = before + inserted + after;
    const labelStart = before.length + 1; // after "["
    return {
      text: newText,
      selStart: labelStart,
      selEnd: labelStart + label.length,
    };
  }

  const url = "url";
  const inserted = `[${selected}](${url})`;
  const newText = before + inserted + after;
  const urlStart = before.length + 1 + selected.length + 2; // "[" + label + "]("
  return {
    text: newText,
    selStart: urlStart,
    selEnd: urlStart + url.length,
  };
}

export function applyMarkdown(
  text: string,
  selStart: number,
  selEnd: number,
  action: MarkdownAction,
): Selection {
  switch (action) {
    case "bold":
    case "italic":
    case "strikethrough":
    case "inlineCode":
      return applyWrap(text, selStart, selEnd, WRAP_MARKS[action]);
    case "heading":
    case "bulletList":
    case "numberedList":
    case "quote":
      return applyLinePrefix(text, selStart, selEnd, action);
    case "link":
      return applyLink(text, selStart, selEnd);
  }
}

// ---------------------------------------------------------------------------
// parseMarkdown
// ---------------------------------------------------------------------------

type LineKind =
  | { kind: "heading"; level: 1 | 2 | 3; content: string }
  | { kind: "bullet"; content: string }
  | { kind: "numbered"; content: string }
  | { kind: "quote"; content: string }
  | { kind: "paragraph"; content: string };

function classifyLine(line: string): LineKind {
  const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
  if (headingMatch) {
    // The `#{1,3}` group bounds the match to 1-3 characters, so `.length`
    // can only ever be 1, 2, or 3 — TypeScript just can't derive that from
    // a regex literal, so the narrowing cast is unavoidable here.
    const level = headingMatch[1].length as 1 | 2 | 3;
    return { kind: "heading", level, content: headingMatch[2] };
  }
  const bulletMatch = /^-\s+(.*)$/.exec(line);
  if (bulletMatch) {
    return { kind: "bullet", content: bulletMatch[1] };
  }
  const numberedMatch = /^\d+\.\s+(.*)$/.exec(line);
  if (numberedMatch) {
    return { kind: "numbered", content: numberedMatch[1] };
  }
  const quoteMatch = /^>\s+(.*)$/.exec(line);
  if (quoteMatch) {
    return { kind: "quote", content: quoteMatch[1] };
  }
  return { kind: "paragraph", content: line };
}

// Inline parsing precedence (per the brief): code spans first (their
// contents are literal), then links, then bold, then strikethrough, then
// italic. Implemented as a recursive-descent scan over one precedence level
// at a time, each level scanning the text left-to-right for its own marker
// and recursing into the remainder / the matched content as appropriate.

function parseInlineCode(text: string): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  const re = /`([^`]+)`/;
  for (;;) {
    const match = re.exec(rest);
    if (!match || match.index === undefined) {
      if (rest.length > 0) nodes.push(...parseLinks(rest));
      break;
    }
    const before = rest.slice(0, match.index);
    if (before.length > 0) nodes.push(...parseLinks(before));
    nodes.push({ type: "code", value: match[1] });
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

// The href group allows one level of nested parens (e.g. "javascript:alert(1)")
// so a malicious-but-well-formed construct like "[x](javascript:alert(1))"
// is captured as a single link construct — label "x", href
// "javascript:alert(1)" — rather than spilling a stray ")" out as trailing
// text. isHttpUrl() below is what actually decides safety; this regex only
// decides where the construct ends.
const LINK_CONSTRUCT_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/;

function parseLinks(text: string): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  const re = LINK_CONSTRUCT_RE;
  for (;;) {
    const match = re.exec(rest);
    if (!match || match.index === undefined) {
      if (rest.length > 0) nodes.push(...parseBold(rest));
      break;
    }
    const before = rest.slice(0, match.index);
    if (before.length > 0) nodes.push(...parseBold(before));

    const label = match[1];
    const href = match[2];
    if (isHttpUrl(href)) {
      nodes.push({
        type: "link",
        href,
        children: parseBold(label),
      });
    } else {
      // Unsafe scheme (javascript:, data:, etc.) — degrade to literal text
      // rather than emit a link node. This is the only place link hrefs are
      // gated; no renderer should need to re-check safety.
      nodes.push({ type: "text", value: match[0] });
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

// Lazy match up to the NEAREST closing `**`, not `[^*]+` (no asterisks at
// all). The latter would refuse to match "**bold *italic* text**" at all —
// its content contains single stars for nested italic — and the whole
// construct would fall through to the italic scanner, shredding it into
// stray literal "*" text nodes. Matching lazily up to the next `**` lets
// the content (which may contain single `*` markers) recurse through the
// remaining precedence chain (strikethrough, then italic) instead.
function parseBold(text: string): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  const re = /\*\*((?:(?!\*\*)[\s\S])+?)\*\*/;
  for (;;) {
    const match = re.exec(rest);
    if (!match || match.index === undefined) {
      if (rest.length > 0) nodes.push(...parseStrikethrough(rest));
      break;
    }
    const before = rest.slice(0, match.index);
    if (before.length > 0) nodes.push(...parseStrikethrough(before));
    nodes.push({ type: "bold", children: parseStrikethrough(match[1]) });
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

function parseStrikethrough(text: string): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  const re = /~~([^~]+)~~/;
  for (;;) {
    const match = re.exec(rest);
    if (!match || match.index === undefined) {
      if (rest.length > 0) nodes.push(...parseItalic(rest));
      break;
    }
    const before = rest.slice(0, match.index);
    if (before.length > 0) nodes.push(...parseItalic(before));
    nodes.push({ type: "strikethrough", children: parseItalic(match[1]) });
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

function parseItalic(text: string): Inline[] {
  const nodes: Inline[] = [];
  // Global + manual `lastIndex` (rather than the shrinking-`rest` loop the
  // other precedence levels use) because a rejected candidate — see
  // `isValidEmphasis` — must not stop the scan: the search has to resume
  // just past the rejected delimiter and keep looking for a later, valid
  // pair, while still coalescing everything skipped into one literal text
  // run rather than fragmenting it.
  const re = /\*([^*]+)\*|_([^_]+)_/g;
  let lastEmitted = 0;
  let searchFrom = 0;
  for (;;) {
    re.lastIndex = searchFrom;
    const match = re.exec(text);
    if (!match) break;
    const content = match[1] ?? match[2] ?? "";
    const start = match.index;
    const end = start + match[0].length;
    if (isValidEmphasis(text, start, end, content)) {
      if (start > lastEmitted) {
        nodes.push({ type: "text", value: text.slice(lastEmitted, start) });
      }
      nodes.push({
        type: "italic",
        children: [{ type: "text", value: content }],
      });
      lastEmitted = end;
      searchFrom = end;
    } else {
      searchFrom = start + 1;
    }
  }
  if (lastEmitted < text.length) {
    nodes.push({ type: "text", value: text.slice(lastEmitted) });
  }
  return nodes;
}

function parseInline(text: string): Inline[] {
  if (text.length === 0) return [];
  return parseInlineCode(text);
}

export function parseMarkdown(md: string): Block[] {
  if (md.length === 0) return [];

  const lines = md.split("\n").map(classifyLine);
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === "bullet") {
      const items: Inline[][] = [];
      while (i < lines.length && lines[i].kind === "bullet") {
        items.push(parseInline(lines[i].content));
        i++;
      }
      blocks.push({ type: "bulletList", items });
      continue;
    }

    if (line.kind === "numbered") {
      const items: Inline[][] = [];
      while (i < lines.length && lines[i].kind === "numbered") {
        items.push(parseInline(lines[i].content));
        i++;
      }
      blocks.push({ type: "numberedList", items });
      continue;
    }

    if (line.kind === "quote") {
      // Consecutive quote lines join into a single quote block, joined by a
      // space (mirrors how the other block types coalesce their lines).
      const contents: string[] = [];
      while (i < lines.length && lines[i].kind === "quote") {
        contents.push(lines[i].content);
        i++;
      }
      blocks.push({ type: "quote", children: parseInline(contents.join(" ")) });
      continue;
    }

    if (line.kind === "heading") {
      blocks.push({
        type: "heading",
        level: line.level,
        children: parseInline(line.content),
      });
      i++;
      continue;
    }

    // Paragraph: consecutive plain lines join into one paragraph, blank
    // lines separate blocks. A blank line is itself a paragraph line with
    // empty content — skip it without starting a new block on its own.
    if (line.content.length === 0) {
      i++;
      continue;
    }

    const contents: string[] = [];
    while (
      i < lines.length &&
      lines[i].kind === "paragraph" &&
      lines[i].content.length > 0
    ) {
      contents.push(lines[i].content);
      i++;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(contents.join(" ")),
    });
  }

  return blocks;
}
