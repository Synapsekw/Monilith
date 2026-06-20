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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <Card>
      <CardHeader>
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
              aria-invalid={form.formState.errors.orgName ? true : undefined}
              {...form.register("orgName")}
            />
            {form.formState.errors.orgName ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.orgName.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspaceName">Workspace name</Label>
            <Input
              id="workspaceName"
              placeholder="Engineering"
              aria-invalid={
                form.formState.errors.workspaceName ? true : undefined
              }
              {...form.register("workspaceName")}
            />
            {form.formState.errors.workspaceName ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.workspaceName.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={isPending} className="w-full">
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
