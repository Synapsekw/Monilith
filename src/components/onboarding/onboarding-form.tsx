"use client";

import { startTransition, useActionState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  type OnboardingState,
  createWorkspaceOrg,
} from "@/app/onboarding/actions";
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
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import {
  type OnboardingInput,
  onboardingSchema,
} from "@/lib/validations/onboarding";

const initialState: OnboardingState = {};

export function OnboardingForm() {
  const [state, formAction, isPending] = useActionState(
    createWorkspaceOrg,
    initialState,
  );

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { orgName: "", workspaceName: "" },
  });

  // Field messages become their input's accessible description; the
  // form-level `state.error` banner stays a whole-form alert.
  const orgNameError = useFieldStatus(form.formState.errors.orgName?.message);
  const workspaceNameError = useFieldStatus(
    form.formState.errors.workspaceName?.message,
  );

  // Submit disables itself synchronously, dropping focus to <body>. The form
  // stays mounted on failure, so return focus to the button when it resolves.
  const submitRef = useRestoreFocusAfterPending<HTMLButtonElement>(isPending);

  return (
    <Card className="shadow-panel [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
      <CardHeader>
        <Kicker>GET STARTED</Kicker>
        <CardTitle>Create your organization</CardTitle>
        <CardDescription>
          Set up your organization and first workspace to get started with
          Monolith.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => {
            const formData = new FormData();
            formData.set("orgName", values.orgName);
            formData.set("workspaceName", values.workspaceName);
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
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              autoComplete="organization"
              placeholder="Acme Inc"
              {...orgNameError.controlProps}
              {...form.register("orgName")}
            />
            <FieldStatus field={orgNameError} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspaceName">Workspace name</Label>
            <Input
              id="workspaceName"
              placeholder="Engineering"
              {...workspaceNameError.controlProps}
              {...form.register("workspaceName")}
            />
            <FieldStatus field={workspaceNameError} />
          </div>

          <Button
            ref={submitRef}
            type="submit"
            disabled={isPending}
            className="shadow-glow-primary w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Creating…
              </>
            ) : (
              "Create organization"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
