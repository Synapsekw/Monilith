/**
 * Model-id normalisation, shared by the two places that have to reconcile the
 * SAME three namespaces:
 *
 *   - the Gateway feed's catalog key   `claude-haiku-4.5`
 *   - the provider's own native id     `claude-haiku-4-5-20251001`
 *   - a hand-written table key         `claude-haiku-4-5` (pricing FALLBACK_RATES)
 *
 * `models/verify-ids.ts` uses it to PROPOSE native ids to a provider (which then
 * judges them), and `pricing.ts` uses it to find a model's price floor. Both had
 * the same latent bug available to them — matching only the literal id — so the
 * rules live here once rather than in two copies.
 *
 * Deliberately PURE and dependency-free: `pricing.ts` carries no "server-only"
 * marker and must stay importable from anywhere.
 */

/** Provider snapshot suffix, e.g. the `-20251001` in `claude-haiku-4-5-20251001`. */
const DATE_SUFFIX = /-\d{8}$/;

/**
 * Candidate native ids for a Gateway catalog key.
 *
 * Normalisation here only PROPOSES candidates — in `verify-ids.ts` the
 * provider's own model list is the judge, and an unmatched row is quarantined
 * rather than guessed at.
 */
export function candidateNativeIds(gatewayModelId: string): string[] {
  const out = [gatewayModelId];
  const hyphenated = gatewayModelId.replace(/\./g, "-");
  if (hyphenated !== gatewayModelId) out.push(hyphenated);
  return out;
}

/**
 * Drop a trailing date snapshot. Only an 8-digit date is stripped — never an
 * arbitrary suffix, which would let `gpt-4-turbo` borrow `gpt-4`'s identity.
 */
export function stripDateSuffix(modelId: string): string {
  return modelId.replace(DATE_SUFFIX, "");
}

/**
 * Is `nativeId` exactly `base` plus a date snapshot?
 *
 * The same knowledge as {@link stripDateSuffix}, read the other way round —
 * `verify-ids` matches a provider's list FORWARD (does anything extend my
 * candidate?) while `pricing` normalises BACKWARD (what is this id without its
 * date?). Defining the forward direction in terms of the backward one is what
 * keeps `\d{8}` in one place: change the snapshot format here and both
 * directions follow. It also needs no regex escaping of `base`, which the
 * hand-built pattern did.
 */
export function isDatedSnapshotOf(base: string, nativeId: string): boolean {
  return nativeId !== base && stripDateSuffix(nativeId) === base;
}
