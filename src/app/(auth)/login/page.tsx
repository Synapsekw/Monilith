import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

// Redirect-carried error codes → human copy. `provisioning` comes from
// /auth/callback when the first-sign-in org provisioning RPC fails.
const ERROR_COPY: Record<string, string> = {
  provisioning:
    "We couldn't finish setting up your account. Please sign in again to retry.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? ERROR_COPY[error] : undefined;

  return (
    <AuthForm
      mode="login"
      initialError={initialError}
      footer={
        <p className="text-muted-foreground text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </p>
      }
    />
  );
}
