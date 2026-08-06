import { describe, expect, it } from "vitest";
import { applyMarkdown, parseMarkdown, stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
  it("returns plain text unchanged (fast path)", () => {
    expect(stripMarkdown("just some words")).toBe("just some words");
  });

  it("returns an empty string unchanged", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it.each([
    ["**bold**", "bold"],
    ["*italic*", "italic"],
    ["~~struck~~", "struck"],
    ["`code`", "code"],
    ["### Heading", "Heading"],
    ["- item", "item"],
    ["1. item", "item"],
    ["> quoted", "quoted"],
    ["[label](https://x.com)", "label"],
    ["**bold** and *italic*", "bold and italic"],
  ])("strips %s", (input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });

  it("flattens newlines to single spaces", () => {
    expect(stripMarkdown("**Q3 goals**\n- ship billing\n- fix auth")).toBe(
      "Q3 goals ship billing fix auth",
    );
  });

  it("collapses runs of whitespace left behind by stripping", () => {
    expect(stripMarkdown("a\n\n\nb")).toBe("a b");
  });

  it("normalises whitespace identically on the fast path and the full-strip path", () => {
    // No Markdown syntax at all -> fast path. Same double-spaced/padded
    // content as below, run through the sniff-triggering "- " prefix -> full
    // path. Both must collapse to the same normalised string.
    expect(stripMarkdown("  padded  text  ")).toBe("padded text");
    expect(stripMarkdown("- padded  text")).toBe("padded text");
  });

  describe("intraword delimiters are literal, not emphasis", () => {
    it.each([
      ["user_id and order_id", "user_id and order_id"],
      ["Deploy to prod_db_2 now", "Deploy to prod_db_2 now"],
      ["snake_case_name.txt", "snake_case_name.txt"],
      ["5 * 3 = 15 * 2", "5 * 3 = 15 * 2"],
    ])("leaves %s unchanged", (input, expected) => {
      expect(stripMarkdown(input)).toBe(expected);
    });
  });

  describe("valid emphasis still strips", () => {
    it.each([
      ["*italic*", "italic"],
      ["_italic_", "italic"],
      ["a *b* c", "a b c"],
    ])("strips %s", (input, expected) => {
      expect(stripMarkdown(input)).toBe(expected);
    });

    // Nested emphasis (`**bold *italic* text**`) is a `parseMarkdown`-only
    // regression, covered below in the `parseMarkdown` suite — stripMarkdown's
    // `BOLD_RE` (unlike `parseBold`) requires bold content to contain no `*`
    // at all, so it never matches a bold span with nested italic in the
    // first place; that is a pre-existing, out-of-scope characteristic of
    // the collapsed-cell strip path, not something this fix touches.
  });
});

describe("applyMarkdown — wrap actions", () => {
  it("wraps a selection in bold marks and keeps it selected", () => {
    // "hello world", selecting "world" (6..11)
    expect(applyMarkdown("hello world", 6, 11, "bold")).toEqual({
      text: "hello **world**",
      selStart: 8,
      selEnd: 13,
    });
  });

  it("unwraps an already-bold selection (toggle)", () => {
    expect(applyMarkdown("hello **world**", 8, 13, "bold")).toEqual({
      text: "hello world",
      selStart: 6,
      selEnd: 11,
    });
  });

  it("inserts marks and places the caret between them on an empty selection", () => {
    expect(applyMarkdown("hi ", 3, 3, "bold")).toEqual({
      text: "hi ****",
      selStart: 5,
      selEnd: 5,
    });
  });

  it("wraps with italic marks", () => {
    expect(applyMarkdown("ab", 0, 2, "italic")).toEqual({
      text: "*ab*",
      selStart: 1,
      selEnd: 3,
    });
  });

  it("wraps with strikethrough marks", () => {
    expect(applyMarkdown("ab", 0, 2, "strikethrough")).toEqual({
      text: "~~ab~~",
      selStart: 2,
      selEnd: 4,
    });
  });

  it("wraps with inline code marks", () => {
    expect(applyMarkdown("ab", 0, 2, "inlineCode")).toEqual({
      text: "`ab`",
      selStart: 1,
      selEnd: 3,
    });
  });

  // Regression: italic-toggling a selection already wrapped in `**bold**`
  // must nest italic marks inside the bold pair, not treat one `*` of the
  // `**` as an (unrelated) italic delimiter and strip it.
  it("nests italic inside existing bold marks instead of corrupting them", () => {
    expect(applyMarkdown("**bold**", 2, 6, "italic")).toEqual({
      text: "***bold***",
      selStart: 3,
      selEnd: 7,
    });
  });
});

describe("applyMarkdown — line-prefix actions", () => {
  it("prefixes a single line with a bullet", () => {
    expect(applyMarkdown("one", 0, 3, "bulletList")).toEqual({
      text: "- one",
      selStart: 2,
      selEnd: 5,
    });
  });

  it("prefixes every line of a multi-line selection", () => {
    expect(applyMarkdown("one\ntwo", 0, 7, "bulletList").text).toBe(
      "- one\n- two",
    );
  });

  it("removes the prefix when every line already has it (toggle)", () => {
    expect(applyMarkdown("- one\n- two", 0, 11, "bulletList").text).toBe(
      "one\ntwo",
    );
  });

  it("numbers a numbered list sequentially from 1", () => {
    expect(applyMarkdown("a\nb\nc", 0, 5, "numberedList").text).toBe(
      "1. a\n2. b\n3. c",
    );
  });

  it("expands a mid-line caret to the whole line", () => {
    // caret sits inside "two" with no selection
    expect(applyMarkdown("one\ntwo", 5, 5, "quote").text).toBe("one\n> two");
  });

  it("prefixes with a heading", () => {
    expect(applyMarkdown("Title", 0, 5, "heading").text).toBe("### Title");
  });
});

describe("applyMarkdown — link", () => {
  it("wraps the selection as a link label and selects the url placeholder", () => {
    const r = applyMarkdown("see docs", 4, 8, "link");
    expect(r.text).toBe("see [docs](url)");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("url");
  });

  it("inserts a full template on an empty selection and selects the label", () => {
    const r = applyMarkdown("", 0, 0, "link");
    expect(r.text).toBe("[text](url)");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("text");
  });
});

describe("parseMarkdown", () => {
  it("parses a paragraph", () => {
    expect(parseMarkdown("hello")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "hello" }] },
    ]);
  });

  it("parses bold inside a paragraph", () => {
    expect(parseMarkdown("a **b** c")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "a " },
          { type: "bold", children: [{ type: "text", value: "b" }] },
          { type: "text", value: " c" },
        ],
      },
    ]);
  });

  // Regression: bold content containing a nested italic span must not be
  // shredded into stray literal "*" text nodes — it should parse as a bold
  // node whose children nest an italic node in the middle.
  it("parses italic nested inside bold", () => {
    expect(parseMarkdown("**bold *italic* text**")).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "bold",
            children: [
              { type: "text", value: "bold " },
              { type: "italic", children: [{ type: "text", value: "italic" }] },
              { type: "text", value: " text" },
            ],
          },
        ],
      },
    ]);
  });

  // FIX 3: the preview must not italicise `user_id` — same intraword rule
  // as stripMarkdown, applied via parseItalic.
  it("does not italicise intraword underscores", () => {
    expect(parseMarkdown("user_id and order_id")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "user_id and order_id" }],
      },
    ]);
  });

  it("does not italicise a whitespace-padded asterisk pair", () => {
    expect(parseMarkdown("5 * 3 = 15 * 2")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "5 * 3 = 15 * 2" }],
      },
    ]);
  });

  it("parses heading levels", () => {
    expect(parseMarkdown("# A")[0]).toMatchObject({
      type: "heading",
      level: 1,
    });
    expect(parseMarkdown("## A")[0]).toMatchObject({
      type: "heading",
      level: 2,
    });
    expect(parseMarkdown("### A")[0]).toMatchObject({
      type: "heading",
      level: 3,
    });
  });

  it("groups consecutive bullet lines into one list block", () => {
    expect(parseMarkdown("- a\n- b")).toEqual([
      {
        type: "bulletList",
        items: [[{ type: "text", value: "a" }], [{ type: "text", value: "b" }]],
      },
    ]);
  });

  it("groups consecutive numbered lines into one list block", () => {
    expect(parseMarkdown("1. a\n2. b")[0]).toMatchObject({
      type: "numberedList",
    });
  });

  it("parses a quote block", () => {
    expect(parseMarkdown("> q")[0]).toMatchObject({ type: "quote" });
  });

  it("treats code span contents as literal, not markup", () => {
    expect(parseMarkdown("`**not bold**`")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "code", value: "**not bold**" }],
      },
    ]);
  });

  it("parses a safe http link", () => {
    expect(parseMarkdown("[x](https://example.com)")).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            href: "https://example.com",
            children: [{ type: "text", value: "x" }],
          },
        ],
      },
    ]);
  });

  it("refuses a javascript: url and emits it as literal text", () => {
    expect(parseMarkdown("[x](javascript:alert(1))")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "[x](javascript:alert(1))" }],
      },
    ]);
  });

  it("refuses a data: url and emits it as literal text", () => {
    const blocks = parseMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(blocks)).not.toContain('"link"');
  });

  it("leaves an unmatched mark as literal text", () => {
    expect(parseMarkdown("a ** b")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "a ** b" }] },
    ]);
  });

  it("returns no blocks for an empty string", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  it("does not lose text when blocks change type", () => {
    const blocks = parseMarkdown("intro\n- a\noutro");
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "bulletList",
      "paragraph",
    ]);
  });
});
