/**
 * Canonical result type for Server Actions.
 *
 * Every server action returns this discriminated union instead of throwing,
 * so client components can narrow on `ok` without try/catch across the
 * RSC/serialization boundary. Import it from here — never re-declare a local
 * copy (the codebase previously had ~20 per-module re-declarations in four
 * divergent shapes; this module is the single home).
 *
 * `T` defaults to `void`: mutation-only actions declare `ActionResult` bare
 * and return `{ ok: true, data: undefined }`.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Failure constructor. Returns the failure arm only, so the result is
 * assignable to `ActionResult<T>` for any `T`.
 */
export function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}
