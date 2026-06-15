# Pulse

A cloud-native **"Work OS"** — a flexible, visual platform for teams to plan, track, and run any
kind of work. Monday.com's color-coded board experience as the foundation, ClickUp's depth folded
in on demand, Asana's polish on top — one coherent product, with Linear-grade restraint applied to
a colorful category. Multi-tenant (org-scoped RLS) from day one; built to stay smooth at
10k-item boards.

**Calm. Capable. Crisp.** — monochrome by default, color carries meaning (status & labels),
depth is progressive.

> 📖 New here? Read the **[documentation index](docs/README.md)**, the
> **[PRD](docs/prd.md)**, and the **[north-star](vault/00-north-star.md)** (current status).

## Tech stack

- **Framework:** Next.js 16 (App Router, RSC, Server Actions) · React 19 · TypeScript (strict)
- **UI:** Tailwind CSS v4 · shadcn/ui (Radix) · Lucide · Framer Motion
- **Backend:** Supabase — Postgres, Auth, RLS, Realtime, Storage, Edge Functions
- **Data layer:** `@supabase/ssr` · TanStack Query · Zod · react-hook-form · TanStack Table + Virtual · dnd-kit
- **Tooling:** pnpm · ESLint + Prettier · Vitest · Playwright · Husky
- **Deploy:** Vercel + Supabase Cloud

> ⚠️ **This is Next.js 16, not the version in your training data.** APIs and conventions differ —
> read `node_modules/next/dist/docs/` before writing framework code. See [`AGENTS.md`](AGENTS.md).

## Quickstart

**Prerequisites:** Node 24 (`nvm use` reads `.nvmrc`) and pnpm 10 (`corepack enable`).

```bash
pnpm install                 # also installs Husky git hooks
cp .env.example .env.local   # then fill in your Supabase keys
pnpm dev                     # http://localhost:3000
```

Required environment variables (see `.env.example`):

| Variable                        | Notes                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (public)                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon / publishable key (public)                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server-only secret** — never prefix with `NEXT_PUBLIC_`, never reaches the browser |

## Scripts

| Script           | Purpose                       |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Run the dev server            |
| `pnpm build`     | Production build              |
| `pnpm start`     | Serve the production build    |
| `pnpm typecheck` | `tsc --noEmit`                |
| `pnpm lint`      | ESLint                        |
| `pnpm test`      | Vitest unit/integration tests |
| `pnpm e2e`       | Playwright end-to-end tests   |
| `pnpm format`    | Prettier write                |

## Documentation

- **[docs/](docs/README.md)** — documentation index (start here)
- **[docs/prd.md](docs/prd.md)** — product requirements (what & why)
- **[Master design spec](docs/superpowers/specs/2026-06-14-pulse-design.md)** — engineering source-of-truth
- **[vault/](vault/README.md)** — dev-memory: north-star, decisions, session notes
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to contribute (branching, commits, tests)
- **[AGENTS.md](AGENTS.md)** — the working agreement

## Status

Early, phased build (0 → 9). Phases 0 (Setup) and 1 (Auth & tenancy) are done; Phase 2 (Boards
core) is in progress. See the [north-star](vault/00-north-star.md) for live status.

## License

See [LICENSE](LICENSE).
