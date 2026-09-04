import type { Block, Inline } from "./markdown";

/**
 * The Markdown AST from `./markdown`, rendered to an HTML string.
 *
 * The React counterpart is `MarkdownPreview.tsx`; neither is derivable from the
 * other (JSX for the cell editor, a string for headless Chromium's
 * `setContent`). This one lives HERE, beside the module that owns the AST, so
 * that adding a `Block`/`Inline` variant fails to typecheck in the sibling file
 * rather than silently vanishing from a rendered document.
 *
 * SECURITY, and it is the whole reason this module is shaped like this: its
 * input is MODEL-AUTHORED text (`create_pdf`), which under prompt injection is
 * attacker-authored. Every value that reaches the output is escaped, so a
 * document can contain no tag, no attribute and no external reference the AST
 * cannot express — and the AST has no image, script or raw-HTML node at all.
 * The rendered document therefore fetches NOTHING, which is what makes it safe
 * to hand to a browser that would happily resolve an `<img src="http://…">`
 * from inside our own function.
 *
 * Pure, synchronous, no DOM, no `server-only`.
 */

/**
 * Local by design. `src/lib/digest/render.ts:16` and
 * `src/lib/agents/briefing-render.ts:41` each keep their own copy; a shared
 * helper is a reasonable future extraction, but it would edit two email
 * renderers that are not part of this change.
 */
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Recurses: bold/italic/strikethrough/link nodes nest arbitrarily.
 *
 * The `: string` on the callback is the same exhaustiveness device `renderBlock`
 * uses, and it is load-bearing for the module contract above: a switch-only body
 * whose declared return type excludes `undefined` makes an unhandled `Inline`
 * variant a compile error (TS2366). Without it the callback's return type would
 * be inferred as `string | undefined`, `join("")` would coerce the `undefined`
 * to `""`, and a new variant would silently vanish from every rendered document.
 */
function renderInline(nodes: Inline[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.value);
        case "bold":
          return `<strong>${renderInline(node.children)}</strong>`;
        case "italic":
          return `<em>${renderInline(node.children)}</em>`;
        case "strikethrough":
          return `<del>${renderInline(node.children)}</del>`;
        case "code":
          return `<code>${escapeHtml(node.value)}</code>`;
        case "link":
          // `parseMarkdown` has already refused any non-http(s) scheme
          // (markdown.ts:470) — a `link` node is known-safe by the time it
          // arrives. The href is escaped anyway: that is the second layer, and
          // it is what stops a quote inside a legitimate https URL from
          // breaking out of the attribute.
          return `<a href="${escapeHtml(node.href)}">${renderInline(node.children)}</a>`;
      }
    })
    .join("");
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${renderInline(block.children)}</p>`;
    case "heading":
      return `<h${block.level}>${renderInline(block.children)}</h${block.level}>`;
    case "quote":
      return `<blockquote>${renderInline(block.children)}</blockquote>`;
    case "bulletList":
      return `<ul>${block.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</ul>`;
    case "numberedList":
      return `<ol>${block.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</ol>`;
  }
}

/** Blocks joined by a newline — readable output, no layout effect in HTML. */
export function renderBlocksToHtml(blocks: Block[]): string {
  return blocks.map(renderBlock).join("\n");
}
