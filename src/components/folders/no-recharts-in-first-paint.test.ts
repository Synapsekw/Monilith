import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/folders/CommandCenter.tsx");
const INNER = join(SRC, "components/folders/charts/BurnChartInner.tsx");

const entryExists = existsSync(ENTRY);

// CommandCenter.tsx is Task 8's file and doesn't exist yet in this worktree —
// skip until it lands so this suite doesn't sit red on the branch; it goes
// live automatically the moment Task 8 adds the file, with no code change
// here required. (reachable() must not run at all when the entry is absent —
// it throws ENOENT reading the file — so the guard has to short-circuit
// before that call, not just skip the `it`s.)
describe("command center first-paint bundle boundary", () => {
  const { files, bare } = entryExists
    ? reachable(ENTRY)
    : { files: new Set<string>(), bare: new Set<string>() };
  it.skipIf(!entryExists)(
    "does not statically reach BurnChartInner from CommandCenter",
    () => {
      expect(files.has(INNER)).toBe(false);
    },
  );
  it.skipIf(!entryExists)(
    "does not statically reach recharts from CommandCenter",
    () => {
      expect(bare.has("recharts")).toBe(false);
    },
  );
});
