import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

// Redirect-carried error codes → human copy. `provisioning` comes from
// /auth/callback when the first-sign-in org provisioning RPC fails.
const ERROR_COPY: Record<string, string> = {
  provisioning:
    "We couldn't finish setting up your account. Please sign in again to retry.",
};

const footer = (
  <p className="text-muted-foreground text-center text-sm">
    Don&apos;t have an account?{" "}
    <Link
      href="/signup"
      className="text-foreground font-medium underline-offset-4 hover:underline"
    >
      Sign up
    </Link>
  </p>
);

// Reading `searchParams` makes this segment dynamic. Under Next.js 16 Cache
// Components, dynamic data must be awaited *inside* a <Suspense> boundary
// (awaiting it at the page level blocks the whole route from prerendering —
// the "Uncached data accessed outside of <Suspense>" build error). So the
// page stays static and the error-aware form streams in behind Suspense.
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<AuthForm mode="login" footer={footer} />}>
      <LoginForm searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? ERROR_COPY[error] : undefined;

  return <AuthForm mode="login" initialError={initialError} footer={footer} />;
}
