"use client";

import { createContext, useContext } from "react";

/**
 * Whether the viewer is a guest of the active org, for the sidebar's board
 * tree. A guest can open what they were given but cannot create boards or
 * folders, rename or delete a folder, or file a board, so those controls are
 * not offered. Provided once by `BoardsNav` from the `isGuest` value the
 * sidebar loader already reads (no extra query), and read by the menus deep
 * in both the plain and the drag-enabled trees. Defaults to false, so every
 * surface outside the sidebar is unchanged.
 */
const NavGuestContext = createContext(false);

export const NavGuestProvider = NavGuestContext.Provider;

export function useNavIsGuest(): boolean {
  return useContext(NavGuestContext);
}
