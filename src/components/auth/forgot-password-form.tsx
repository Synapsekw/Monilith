"use client";

import { type ReactNode, startTransition, useActionState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { type AuthState, requestPasswordReset } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kicker } from "@/components/ui/kicker";
import { Label } from "@/components/ui/label";
import {
  type ForgotPasswordInput,
  forgotPasswordSchema,
} from "@/lib/validations/auth";

const initialState: AuthState = {};

export function ForgotPasswordForm({ footer }: { footer?: ReactNode }) {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  if (state.success === "reset-email-sent") {
    return (
      <Card className="shadow-panel [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="text-primary mb-1 size-8" />
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If an account exists for that address, we sent a password reset
            link. Click it to choose a new password.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="shadow-panel [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
      <CardHeader>
        <Kicker>RESET</Kicker>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => {
            // Client-side Zod validation passed — hand the validated values to
            // the server action via useActionState's dispatcher.
            const formData = new FormData();
            formData.set("email", values.email);
            startTransition(() => {
              formAction(formData);
            });
          })}
          className="flex flex-col gap-4"
        >
          {state.error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={form.formState.errors.email ? true : undefined}
              {...form.register("email")}
            />
            {form.formState.errors.email ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="shadow-glow-primary w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Sending link…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>

          {footer ? <div className="pt-1">{footer}</div> : null}
        </form>
      </CardContent>
    </Card>
  );
}
