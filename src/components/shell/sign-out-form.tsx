"use client";

import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { signOut } from "@/app/auth/actions";
import { wipeOfflineData } from "@/lib/offline/wipe";

/**
 * Sign-out control, split out of `UserMenu` as its own client component.
 *
 * `wipeOfflineData` touches localStorage, IndexedDB and the Cache API —
 * browser-only APIs. `UserMenu` is a Server Component; an inline `<form
 * action>` defined there is compiled as a Server Action and would run this
 * on the server, where none of those globals exist. Isolating the form here
 * keeps the client boundary as small as possible instead of making the
 * whole menu (and its dropdown subtree) client-side.
 *
 * Forwards its ref and props to the underlying `<form>` so `DropdownMenuItem
 * asChild` (Radix `Slot`) can clone its interaction props onto the real DOM
 * node, the same way it already does for the `next/link` Settings item.
 */
export const SignOutForm = forwardRef<
  HTMLFormElement,
  ComponentPropsWithoutRef<"form">
>(function SignOutForm(props, ref) {
  return (
    <form
      {...props}
      ref={ref}
      action={async () => {
        // Must run before the action redirects: a Server Action cannot
        // reach IndexedDB or the Cache API, so this is the only point
        // at which the signed-out user's boards can be removed from
        // disk.
        await wipeOfflineData();
        await signOut();
      }}
    >
      <button type="submit" className="w-full text-left">
        Sign out
      </button>
    </form>
  );
});
