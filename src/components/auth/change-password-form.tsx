"use client";

import { startTransition, useActionState, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kicker } from "@/components/ui/kicker";
import { Label } from "@/components/ui/label";
import {
  type ChangePasswordInput,
  changePasswordSchema,
} from "@/lib/validations/auth";

const initialState: AuthState = {};

/**
 * A password input with its own reveal/hide toggle. Each instance owns its
 * visibility, so revealing one field never exposes another. The icon button is
 * labelled per field (`Show/Hide <label>`) for screen readers.
 */
function PasswordField({
  id,
  label,
  placeholder,
  registration,
  error,
}: {
  id: string;
  label: string;
  placeholder: string;
  registration: UseFormRegisterReturn;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup>
        <InputGroupInput
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          {...registration}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

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
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    changeOwnPassword,
    initialState,
  );

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  return (
    <Card className="shadow-panel [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
      <CardHeader>
        <div className="bg-surface mb-1 flex size-9 items-center justify-center rounded-lg border">
          <KeyRound className="text-primary size-4" />
        </div>
        <Kicker>SECURITY</Kicker>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          {variant === "recovery"
            ? "Enter a new password for your account to finish resetting it."
            : "Your administrator set a temporary password. Pick a new one to continue."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => {
            // Client-side Zod validation (incl. the confirm-match refine) passed
            // — hand the validated values to the server action, which re-checks.
            const formData = new FormData();
            formData.set("password", values.password);
            formData.set("confirmPassword", values.confirmPassword);
            startTransition(() => {
              formAction(formData);
            });
          })}
          className="space-y-4"
        >
          {state.error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm"
            >
              {state.error}
            </p>
          ) : null}

          <PasswordField
            id="password"
            label="New password"
            placeholder="At least 8 characters"
            registration={form.register("password")}
            error={form.formState.errors.password?.message}
          />

          <PasswordField
            id="confirmPassword"
            label="Confirm new password"
            placeholder="Re-enter your new password"
            registration={form.register("confirmPassword")}
            error={form.formState.errors.confirmPassword?.message}
          />

          <Button
            type="submit"
            className="shadow-glow-primary w-full"
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
