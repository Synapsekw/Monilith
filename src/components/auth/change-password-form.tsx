"use client";

import { useActionState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { changeOwnPassword } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthState = {};

/**
 * `forced` (default) — the admin-set-temporary-password path (app_metadata
 * must_change_password). `recovery` — the self-serve forgot-password flow,
 * reached via the recovery link → /auth/callback → here; same form, honest
 * copy (no "administrator" framing).
 */
export function ChangePasswordForm({
  variant = "forced",
}: {
  variant?: "forced" | "recovery";
} = {}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    changeOwnPassword,
    initialState,
  );

  return (
    <Card>
      <CardHeader>
        <div className="bg-surface mb-1 flex size-9 items-center justify-center rounded-lg border">
          <KeyRound className="text-primary size-4" />
        </div>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          {variant === "recovery"
            ? "Enter a new password for your account to finish resetting it."
            : "Your administrator set a temporary password. Pick a new one to continue."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              aria-label="New password"
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "password-error" : undefined}
            />
          </div>
          {state.error && (
            <p
              id="password-error"
              role="alert"
              className="text-destructive text-xs"
            >
              {state.error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
