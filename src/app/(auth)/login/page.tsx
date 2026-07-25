import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { AuthForm } from "@/components/auth/auth-form";
import { safeNextPath } from "@/lib/auth/next-path";

// Redirect-carried error codes → human copy. `provisioning` comes from
// /auth/callback when the first-sign-in org provisioning RPC fails.
const ERROR_COPY: Record<string, string> = {
  provisioning:
    "We couldn't finish setting up your account. Please sign in again to retry.",
};

// The sign-up link must carry `next` too, or switching forms silently drops the
// destination the user was originally headed to.
function Footer({ next }: { next?: string }) {
  return (
    <p className="text-muted-foreground text-center text-sm">
      Don&apos;t have an account?{" "}
      <Link
        href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
        className="text-foreground font-medium underline-offset-4 hover:underline"
      >
        Sign up
      </Link>
    </p>
  );
}

// Reading `searchParams` makes this segment dynamic. Under Next.js 16 Cache
// Components, dynamic data must be awaited *inside* a <Suspense> boundary
// (awaiting it at the page level blocks the whole route from prerendering —
// the "Uncached data accessed outside of <Suspense>" build error). So the
// page stays static and the error-aware form streams in behind Suspense.
type LoginSearchParams = {
  error?: string;
  next?: string | string[];
  deleted?: string;
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  return (
    <Suspense fallback={<AuthForm mode="login" footer={<Footer />} />}>
      <LoginForm searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const { error, next, deleted } = await searchParams;
  const initialError = error ? ERROR_COPY[error] : undefined;
  // "/" is the default destination, so treat it as "no next" and keep the
  // markup free of a redundant param.
  const safeNext = safeNextPath(next);
  const nextTarget = safeNext === "/" ? undefined : safeNext;

  return (
    <div className="space-y-4">
      {/* `?deleted=1` is set by deleteOwnAccount's redirect. Landing on a bare
          login form after erasing your account reads as a failure, so confirm it
          — as a notice, not an error banner. */}
      {deleted ? (
        <div
          role="status"
          className="bg-surface text-muted-foreground flex items-start gap-2 rounded-lg border p-3 text-sm"
        >
          <CheckCircle2
            className="text-primary mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          <span>
            Your account has been deleted. Thanks for trying Monolith.
          </span>
        </div>
      ) : null}
      <AuthForm
        mode="login"
        initialError={initialError}
        next={nextTarget}
        footer={<Footer next={nextTarget} />}
      />
    </div>
  );
}
