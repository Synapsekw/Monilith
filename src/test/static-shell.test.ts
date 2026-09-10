import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every `(app)` route must keep a prerendered STATIC SHELL.
 *
 * Under Cache Components (`cacheComponents: true` in next.config.ts) a route's
 * shell is whatever Next.js can finish rendering at build time. The `(app)`
 * group layout and `AuthenticatedShell` sit ABOVE every Suspense boundary in
 * the tree, so a single awaited request-time API in either of them makes the
 * whole route dynamic and the shell empty. That regression shipped once: an
 * `await cookies()` in `AuthenticatedShell` (to seed the device timezone) left
 * `.next/server/app/my-work.html`, `.next/server/app/boards/[boardId].html`
 * and every `settings/*.html` at exactly **0 bytes**, while `/ask` — whose
 * layout reads no cookie — prerendered ~9 KB. A cold visit then painted
 * nothing until the server had rendered the layout; `loading.tsx` skeletons do
 * not help a cold load, they only cover client navigation.
 *
 * `pnpm build` exits 0 in that state, so nothing else catches it. The fix (and
 * the shape this test locks in) is the pattern Next's own "Maximizing the
 * static shell" guidance prescribes: call the runtime API WITHOUT awaiting and
 * pass the promise down to a consumer that already suspends behind a fallback.
 *
 * The build-level proof is `ls -la .next/server/app/my-work.html` after
 * `pnpm build` — both files non-zero. This test is the cheap guard that fails
 * in `pnpm test` long before anyone thinks to run that.
 */

/** Server files rendered above every Suspense boundary of the `(app)` group. */
const SHELL_FILES = [
  "src/app/(app)/layout.tsx",
  "src/components/shell/authenticated-shell.tsx",
];

/**
 * Next.js runtime APIs that return a promise. Awaiting any of them opts the
 * caller — and everything above it — out of the prerender.
 */
const RUNTIME_APIS = ["cookies", "headers", "draftMode", "connection"];

/** Drop comments so a docblock mentioning `await cookies()` is not a hit. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Which runtime APIs this source awaits, if any. */
function awaitedRuntimeApis(source: string): string[] {
  return RUNTIME_APIS.filter((api) =>
    new RegExp(`await\\s+${api}\\s*\\(`).test(source),
  );
}

/**
 * Whether the source exports an async component, in either shape React
 * components are written in here: `export [default] async function Foo` and
 * `export const Foo = async (` (with or without a type annotation). A
 * non-exported local async helper is fine — only what the layout renders
 * matters.
 */
function declaresAsyncComponent(source: string): boolean {
  return (
    /export\s+(?:default\s+)?async\s+function/.test(source) ||
    /export\s+const\s+\w+\s*(?::[^=]+)?=\s*async\s*[(<]/.test(source)
  );
}

describe("the (app) static-shell detectors", () => {
  it("catches an awaited runtime API", () => {
    expect(awaitedRuntimeApis("const c = await cookies();")).toEqual([
      "cookies",
    ]);
    expect(awaitedRuntimeApis("cookies().then((c) => c.get('x'));")).toEqual(
      [],
    );
  });

  it("catches every exported async component shape", () => {
    expect(declaresAsyncComponent("export async function Foo() {}")).toBe(true);
    expect(
      declaresAsyncComponent("export default async function Foo() {}"),
    ).toBe(true);
    expect(declaresAsyncComponent("export const Foo = async () => {};")).toBe(
      true,
    );
    expect(
      declaresAsyncComponent("export const Foo: FC<P> = async () => {};"),
    ).toBe(true);
  });

  it("does not flag synchronous components or local async helpers", () => {
    expect(declaresAsyncComponent("export function Foo() {}")).toBe(false);
    expect(declaresAsyncComponent("export const Foo = () => {};")).toBe(false);
    expect(declaresAsyncComponent("const load = async () => {};")).toBe(false);
  });
});

describe("(app) static shell", () => {
  for (const relative of SHELL_FILES) {
    const source = stripComments(
      readFileSync(join(process.cwd(), relative), "utf8"),
    );

    it(`${relative} awaits no request-time API`, () => {
      expect(awaitedRuntimeApis(source)).toEqual([]);
    });

    it(`${relative} declares no async component`, () => {
      // A non-async component cannot await anything, which is the invariant
      // above stated structurally rather than by pattern-matching.
      expect(declaresAsyncComponent(source)).toBe(false);
    });
  }
});
