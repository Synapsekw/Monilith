/** A person's initials ("Ada Lovelace" → "AL"). Dependency-free on purpose:
 *  folder surfaces import it without dragging the avatar renderer (Mono
 *  canvas, next/image) into their first-load bundle. */
export function memberInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
