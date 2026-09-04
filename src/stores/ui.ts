import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Ephemeral UI state only (per the brief, server state lives in Supabase/TanStack Query).
 * `sidebarCollapsed` is persisted to localStorage; `hasHydrated` flips true once that
 * persisted value has rehydrated, so the UI can render the SSR-safe default first.
 */
interface UIState {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
  newBoardOpen: boolean;
  setNewBoardOpen: (open: boolean) => void;
  newDashboardOpen: boolean;
  setNewDashboardOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  /**
   * Which nav sections are COLLAPSED, persisted to localStorage. Absent means
   * open — both readers test `!map[key]` (`nav-section.tsx`,
   * `BoardFolderRow.tsx`), so `false` and absent are indistinguishable and only
   * `false` costs storage. Every writer below therefore deletes rather than
   * writing `false`, and `pruneSections` clears keys whose owner is gone.
   */
  collapsedSections: Record<string, boolean>;
  toggleSection: (key: string) => void;
  /** Set a section's state without flipping it. Idempotent. */
  setSection: (key: string, collapsed: boolean) => void;
  /**
   * Drop `prefix`-scoped keys whose suffix is not in `keep` — how a deleted
   * folder's key stops outliving the folder. Keys without the prefix are never
   * touched. Returns the state unchanged (identical map object) when nothing
   * was stale, so an effect calling this cannot loop.
   */
  pruneSections: (prefix: string, keep: ReadonlySet<string>) => void;
}

/** `{ [key]: _, ...rest }` with a computed key, as a named helper. */
function withoutKey(
  map: Record<string, boolean>,
  key: string,
): Record<string, boolean> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
      newBoardOpen: false,
      setNewBoardOpen: (open) => set({ newBoardOpen: open }),
      newDashboardOpen: false,
      setNewDashboardOpen: (open) => set({ newDashboardOpen: open }),
      collapsedSections: {},
      toggleSection: (key) =>
        set((s) => ({
          collapsedSections: s.collapsedSections[key]
            ? // Re-opening DELETES the key. Writing `false` would leave one
              // entry per section the user ever collapsed, forever.
              withoutKey(s.collapsedSections, key)
            : { ...s.collapsedSections, [key]: true },
        })),
      setSection: (key, collapsed) =>
        set((s) => {
          if (collapsed) {
            if (s.collapsedSections[key]) return s;
            return {
              collapsedSections: { ...s.collapsedSections, [key]: true },
            };
          }
          const next = withoutKey(s.collapsedSections, key);
          return next === s.collapsedSections ? s : { collapsedSections: next };
        }),
      pruneSections: (prefix, keep) =>
        set((s) => {
          const stale = Object.keys(s.collapsedSections).filter(
            (key) =>
              key.startsWith(prefix) && !keep.has(key.slice(prefix.length)),
          );
          if (stale.length === 0) return s;
          const next = { ...s.collapsedSections };
          for (const key of stale) delete next[key];
          return { collapsedSections: next };
        }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "pulse-ui",
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        collapsedSections: s.collapsedSections,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);
