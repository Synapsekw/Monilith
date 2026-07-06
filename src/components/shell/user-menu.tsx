import Link from "next/link";
import { Settings } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AppShellUser = {
  email?: string | null;
  full_name?: string | null;
};

function initialFor(user: AppShellUser): string {
  const source = user.full_name?.trim() || user.email?.trim() || "";
  return source ? source.charAt(0).toUpperCase() : "?";
}

export function UserMenu({ user }: { user: AppShellUser }) {
  const label = user.full_name?.trim() || user.email || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user menu"
        className="bg-surface text-foreground hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {initialFor(user)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild variant="destructive">
          <form action={signOut}>
            <button type="submit" className="w-full text-left">
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
