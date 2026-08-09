#!/usr/bin/env node
/**
 * check-board-chrome.mjs
 *
 * The mission-control board (`vault/board.html`) is a DERIVED view with a
 * deliberate split: the `#board-data` JSON island is DATA, refreshed every
 * `/board` and every `/wrapup`; everything around it — markup, CSS, render JS —
 * is DESIGN, and changes only when the owner asks for a redesign.
 *
 * Nothing structural enforced that split, so a refresh could quietly restyle
 * the board while "just updating the numbers". This guard hashes the chrome
 * (the file with the island's CONTENTS blanked) and compares it to a recorded
 * baseline. A data-only refresh passes untouched; any design edit fails loudly
 * and has to be accepted on purpose.
 *
 *   node scripts/check-board-chrome.mjs            # verify (exit 1 on drift)
 *   node scripts/check-board-chrome.mjs --accept   # re-baseline after a redesign
 *
 * Exit 0 clean, 1 on drift or a malformed file. Written in node so the logic is
 * unit-testable in the same `pnpm test` gate as everything else (AGENTS.md #4).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ISLAND =
  /(<script type="application\/json" id="board-data">)([\s\S]*?)(<\/script>)/;

/**
 * Strip the data island's contents, leaving every byte of design intact.
 * @param {string} html
 * @returns {string} the chrome, with the island body replaced by a placeholder
 */
export function extractChrome(html) {
  const m = html.match(ISLAND);
  if (!m) {
    throw new Error(
      'no <script type="application/json" id="board-data"> island found — ' +
        "the board's data/design split is broken, not just drifted",
    );
  }
  return html.replace(ISLAND, `$1\n{{BOARD_DATA}}\n$3`);
}

/** @param {string} html */
export function chromeHash(html) {
  return createHash("sha256").update(extractChrome(html), "utf8").digest("hex");
}

/**
 * @param {{html: string, baseline: string | null}} input
 * @returns {{ok: boolean, hash: string, reason?: "missing-baseline" | "drift"}}
 */
export function verifyChrome({ html, baseline }) {
  const hash = chromeHash(html);
  if (baseline === null) return { ok: false, hash, reason: "missing-baseline" };
  if (baseline.trim() !== hash) return { ok: false, hash, reason: "drift" };
  return { ok: true, hash };
}

const BOARD = "vault/board.html";
const BASELINE = "vault/.board-chrome.sha256";

function main(argv) {
  const accept = argv.includes("--accept");
  const html = readFileSync(BOARD, "utf8");

  if (accept) {
    const hash = chromeHash(html);
    writeFileSync(BASELINE, hash + "\n");
    console.log(`board chrome re-baselined: ${hash.slice(0, 12)}…`);
    console.log(`Commit ${BASELINE} with the redesign.`);
    return 0;
  }

  const baseline = existsSync(BASELINE) ? readFileSync(BASELINE, "utf8") : null;
  const { ok, hash, reason } = verifyChrome({ html, baseline });

  if (ok) {
    console.log(
      `board chrome unchanged (${hash.slice(0, 12)}…) — data-only refresh`,
    );
    return 0;
  }

  if (reason === "missing-baseline") {
    console.error(
      `${BASELINE} is missing. Run with --accept to record the current design.`,
    );
    return 1;
  }

  console.error(
    [
      "",
      "  BOARD DESIGN DRIFT — the markup, CSS or render JS of vault/board.html changed.",
      "",
      "  A /board or /wrapup refresh must edit ONLY the #board-data JSON island.",
      "  Do not deploy this. Restore the design and keep your data edits:",
      "",
      "    git diff vault/board.html          # see what moved outside the island",
      "    git checkout -- vault/board.html   # discard ALL edits, then redo data only",
      "",
      "  If the owner ASKED for a redesign, accept it deliberately:",
      "",
      "    node scripts/check-board-chrome.mjs --accept",
      "",
    ].join("\n"),
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
