"use client";

import { useMemo } from "react";
import type { Block, Inline } from "@/lib/boards/markdown";
import { parseMarkdown } from "@/lib/boards/markdown";

/**
 * Recursively renders inline nodes to React elements. Bold/italic/
 * strikethrough/link nodes carry `children: Inline[]` and can nest
 * arbitrarily (e.g. `**bold *italic* text**`), so this must recurse rather
 * than assume a single level of marks.
 *
 * `parseMarkdown` already gates every link href through `isHttpUrl` and
 * degrades an unsafe href (e.g. `javascript:`) to a plain text node before
 * it ever reaches here — a `link` node in the AST is already known-safe, so
 * there is no second URL check here.
 */
function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value.length > 0 ? node.value : null;
      case "bold":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "strikethrough":
        return <del key={i}>{renderInline(node.children)}</del>;
      case "code":
        return <code key={i}>{node.value}</code>;
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} className="text-sm leading-relaxed">
          {renderInline(block.children)}
        </p>
      );
    case "heading": {
      const className = "font-bold text-foreground";
      switch (block.level) {
        case 1:
          return (
            <h1 key={key} className={`${className} text-lg`}>
              {renderInline(block.children)}
            </h1>
          );
        case 2:
          return (
            <h2 key={key} className={`${className} text-base`}>
              {renderInline(block.children)}
            </h2>
          );
        case 3:
          return (
            <h3 key={key} className={`${className} text-sm`}>
              {renderInline(block.children)}
            </h3>
          );
      }
      break;
    }
    case "quote":
      return (
        <blockquote
          key={key}
          className="text-muted-foreground border-border border-l-2 pl-3 text-sm italic"
        >
          {renderInline(block.children)}
        </blockquote>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5 text-sm">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "numberedList":
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5 text-sm">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
  }
}

export function MarkdownPreview({
  markdown,
}: {
  markdown: string;
}): React.JSX.Element {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  // `markdown.trim()` (not `blocks.length`) is the correct emptiness check:
  // whitespace-only input (e.g. "   ") still parses to a non-empty
  // Block[] — a paragraph holding a whitespace-only text node — so
  // `blocks.length === 0` alone misses it and renders a blank paragraph
  // instead of the empty state.
  if (markdown.trim().length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic">Nothing to preview</p>
    );
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}
