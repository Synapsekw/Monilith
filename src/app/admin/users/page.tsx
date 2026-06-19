import { UserSearch } from "@/components/admin/user-search";

export const metadata = { title: "Platform admin · users" };

export default function AdminUsers() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Users
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Find any user across all organizations.
        </p>
      </header>
      <UserSearch />
    </div>
  );
}
