import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { safeNextPath } from "@/lib/auth/next-path";

function Footer({ next }: { next?: string }) {
  return (
    <p className="text-muted-foreground text-center text-sm">
      Already have an account?{" "}
      <Link
        href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
        className="text-foreground font-medium underline-offset-4 hover:underline"
      >
        Sign in
      </Link>
    </p>
  );
}

// Reading `searchParams` makes this segment dynamic, so the form streams in
// behind a <Suspense> boundary — same Cache Components constraint as /login.
export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<AuthForm mode="signup" footer={<Footer />} />}>
      <SignupForm searchParams={searchParams} />
    </Suspense>
  );
}

async function SignupForm({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);
  const nextTarget = safeNext === "/" ? undefined : safeNext;

  return (
    <AuthForm
      mode="signup"
      next={nextTarget}
      footer={<Footer next={nextTarget} />}
    />
  );
}
