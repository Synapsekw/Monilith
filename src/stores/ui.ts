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
  askPulseOpen: boolean;
  setAskPulseOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  collapsedSections: Record<string, boolean>;
  toggleSection: (key: string) => void;
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
      askPulseOpen: false,
      setAskPulseOpen: (open) => set({ askPulseOpen: open }),
      collapsedSections: {},
      toggleSection: (key) =>
        set((s) => ({
          collapsedSections: {
            ...s.collapsedSections,
            [key]: !s.collapsedSections[key],
          },
        })),
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
