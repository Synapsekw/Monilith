/**
 * Categorical ramp for report charts, on the report's WHITE print surface.
 *
 * NOT the app's `--chart-cat-*` palette: those hues are stepped for the app's
 * near-black surface and FAIL on paper. Validated with the `dataviz` skill's
 * scripts/validate_palette.js against #ffffff, they return exit 1 —
 * lightness-band FAIL (#22d3ee L .797, #34d399 L .773, both above the .77
 * ceiling) and CVD-separation FAIL (worst adjacent #34d399↔#fb7185 ΔE 4.6
 * deutan, below the 6 floor).
 *
 * This ramp — slot 1 = the report's own periwinkle accent, slots 2–8 = the
 * dataviz reference light palette — was validated on the same surface:
 *
 *   node scripts/validate_palette.js \
 *     "#5866c4,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" \
 *     --mode light --surface "#ffffff"
 *   → ALL CHECKS PASS (band PASS · chroma PASS · CVD PASS worst adjacent
 *     ΔE 9.1 protan · normal-vision PASS ΔE 19.6 · contrast WARN on slots
 *     3/4/5)
 *
 * The contrast WARN is the skill's *relief* case and is DISCHARGED, not
 * dismissed: every chart mark ships a visible label + value + share, and the
 * report's Board-table / Appendix blocks are the table-view twin. Do not edit
 * these hexes without re-running the validator on #ffffff.
 */
export const PRINT_CATEGORICAL = [
  "#5866c4", // periwinkle — the report accent (--peri)
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/**
 * Reserved neutral: the "no value" category and the "Other" fold-in bucket.
 * Never a categorical slot — it must not read as an identity.
 */
export const PRINT_NEUTRAL = "#9aa1b1";

/**
 * The ramp hex for a zero-based slot. `index` MUST be an entity-stable position
 * (an option's index in its column's settings), never a rank in the sorted
 * chart — "color follows the entity, never its rank". Wrapping past eight is a
 * last-resort fallback for a column with 9+ uncolored options; charts cap at 6
 * categories, so it is not reachable through normal use.
 */
export function rampSlot(index: number): string {
  return PRINT_CATEGORICAL[index % PRINT_CATEGORICAL.length];
}
