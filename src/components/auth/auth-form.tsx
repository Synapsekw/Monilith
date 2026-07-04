"use client";

import { type ReactNode, startTransition, useActionState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { type AuthState, signIn, signUp } from "@/app/auth/actions";
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

export function AuthForm({ mode, footer, initialError }: AuthFormProps) {
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

  if (state.success === "check-email") {
    return (
      <Card>
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
    <Card>
      <CardHeader>
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
                aria-invalid={
                  "orgName" in form.formState.errors &&
                  form.formState.errors.orgName
                    ? true
                    : undefined
                }
                {...form.register("orgName")}
              />
              {"orgName" in form.formState.errors &&
              form.formState.errors.orgName ? (
                <p className="text-destructive text-xs">
                  {form.formState.errors.orgName.message}
                </p>
              ) : null}
            </div>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="••••••••"
              aria-invalid={form.formState.errors.password ? true : undefined}
              {...form.register("password")}
            />
            {form.formState.errors.password ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.password.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={isPending} className="w-full">
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
