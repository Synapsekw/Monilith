"use client";

import { type ReactNode, startTransition, useActionState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { signIn, signUp } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { Input } from "@/components/ui/input";
import { Kicker } from "@/components/ui/kicker";
import { Label } from "@/components/ui/label";
import {
  type SignInInput,
  type SignUpInput,
  signInSchema,
  signUpSchema,
} from "@/lib/validations/auth";

type AuthFormProps = {
  mode: "login" | "signup";
  footer?: ReactNode;
  /** Seed an error banner on first render (e.g. from a `?error=` redirect). */
  initialError?: string;
  /**
   * Already-sanitized post-sign-in destination (from the page's `?next=`). It
   * rides along as a FormData field because this form is submitted through
   * `useActionState`, which has no access to the page URL. The server action
   * sanitizes it AGAIN — a client can forge this field freely.
   */
  next?: string;
};

const copy = {
  login: {
    title: "Welcome back",
    description: "Sign in to your Monolith workspace.",
    submit: "Sign in",
    pending: "Signing in…",
  },
  signup: {
    title: "Create your account",
    description: "Start organizing your work with Monolith.",
    submit: "Create account",
    pending: "Creating account…",
  },
} as const;

export function AuthForm({ mode, footer, initialError, next }: AuthFormProps) {
  const isSignup = mode === "signup";
  const text = copy[mode];

  const action = isSignup ? signUp : signIn;
  const [state, formAction, isPending] = useActionState(action, {
    error: initialError,
  });

  const form = useForm<SignInInput | SignUpInput>({
    resolver: zodResolver(isSignup ? signUpSchema : signInSchema),
    defaultValues: isSignup
      ? { email: "", password: "", orgName: "" }
      : { email: "", password: "" },
  });

  // Each field's validation message becomes that input's accessible
  // DESCRIPTION, so a screen-reader user tabbing back after a failed submit
  // hears why. The form-level `state.error` banner below is deliberately NOT
  // wired this way: it belongs to the whole form, not to one control.
  const errors = form.formState.errors;
  const orgNameError = useFieldStatus(
    "orgName" in errors ? errors.orgName?.message : undefined,
  );
  const emailError = useFieldStatus(errors.email?.message);
  const passwordError = useFieldStatus(errors.password?.message);

  if (state.success === "check-email") {
    return (
      <Card className="shadow-panel [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="text-primary mb-1 size-8" />
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a confirmation link to your inbox. Click it to finish
            setting up your account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="shadow-panel [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
      <CardHeader>
        <Kicker>{isSignup ? "GET STARTED" : "WELCOME"}</Kicker>
        <CardTitle>{text.title}</CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => {
            // Client-side Zod validation passed — hand the validated values to
            // the server action via useActionState's dispatcher.
            const formData = new FormData();
            formData.set("email", values.email);
            formData.set("password", values.password);
            if (isSignup && "orgName" in values && values.orgName) {
              formData.set("orgName", values.orgName);
            }
            // NOTE: this form does not submit the DOM, so a hidden <input> would
            // never be read — the field has to be set here.
            if (next) formData.set("next", next);
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

          {isSignup ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orgName">Organization name</Label>
              <Input
                id="orgName"
                autoComplete="organization"
                placeholder="Acme Inc."
                {...orgNameError.controlProps}
                {...form.register("orgName")}
              />
              <FieldStatus field={orgNameError} />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...emailError.controlProps}
              {...form.register("email")}
            />
            <FieldStatus field={emailError} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="••••••••"
              {...passwordError.controlProps}
              {...form.register("password")}
            />
            <FieldStatus field={passwordError} />
            {!isSignup ? (
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground self-end text-xs underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
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
                {text.pending}
              </>
            ) : (
              text.submit
            )}
          </Button>

          {footer ? <div className="pt-1">{footer}</div> : null}
        </form>
      </CardContent>
    </Card>
  );
}
