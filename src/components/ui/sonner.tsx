"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

/** App-wide toaster. Mounted once in the (app) layout; themed via next-themes. */
export function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  const { theme = "system" } = useTheme();
  return (
    <SonnerToaster
      theme={theme as "light" | "dark" | "system"}
      position="bottom-right"
      closeButton
      {...props}
    />
  );
}
