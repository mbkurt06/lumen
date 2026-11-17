# AGENTS.md

Instructions for every AI coding agent working in this repository (Claude Code, Codex, Jules, Copilot, Gemini).
Read this file fully before changing anything.

## Project

Lumen ("Content Workspace") is an offline-first content, practice, scheduling and media app.

- Web app: Next.js 15 (App Router), React 19, TypeScript, installable PWA.
- Data: Supabase (PostgreSQL, auth, sync) + IndexedDB and Cache Storage for offline use.
- Hosting: Vercel. Every PR gets a preview deployment; `main` is staging; the `production` branch is released by hand.
- `Lumen/` contains a separate native Swift client. Do not touch it unless the issue explicitly asks.

## Layout

| Path | What it holds |
| --- | --- |
| `app/` | Routes, layout, PWA manifest, API routes under `app/api/` |
| `components/` | React components (`*View.tsx` are screens) |
| `lib/` | Data access, offline storage, sync, integrations |
| `supabase/migrations/` | Database migrations, numbered `NNNN_name.sql` |
| `scripts/` | Local tooling and content validation |
| `docs/` | Deployment and security notes |
| `tests/e2e/` | Acceptance tests (protected, see rules) |

## Commands

```bash
npm install        # install dependencies
npm run build      # production build; also type-checks the project
npm run dev        # local dev server on port 3100
npm run test:e2e   # Playwright acceptance tests (needs `npx playwright install chromium` once)
```

CI runs the build and the acceptance tests in `tests/e2e/` on every PR. A change is not done until both pass.
If an acceptance test fails, fix the app, never the test.

## How to work

1. Work only on the issue you were given. One issue = one branch = one PR.
2. Keep the change small. If the issue is too big, say so in a comment and propose a split instead of writing a huge PR.
3. Follow the existing style of the file you edit. TypeScript strict, functional React components, no new UI library.
4. Do not add dependencies unless the issue requires it; explain any new dependency in the PR description.
5. In the PR description write: what changed, why, how you verified it, and anything left open.
6. If you are blocked or unsure about product behaviour, stop and comment on the issue instead of guessing.

## Hard rules (never break these)

- Never edit files in `tests/e2e/`. Acceptance tests are owned by the maintainer. If one seems wrong, comment instead.
- Never edit `.github/workflows/`, `AGENTS.md`, `CLAUDE.md` or `.github/CODEOWNERS` unless the issue explicitly asks.
- Never create or change files in `supabase/migrations/` without an issue that explicitly asks for a schema change. Never edit an existing migration; add a new numbered one.
- Never commit secrets, `.env*` files (except `.env.example` with placeholders), keys, certificates or user content.
- `NEXT_PUBLIC_*` values are public. Never put a service-role key or any private credential in one.
- Every user-owned table exposed to the browser must keep row-level security enabled.
- Never push to `main`. Always open a pull request.
- Offline behaviour matters: do not break IndexedDB / Service Worker paths without saying so in the PR.

## Review guidelines

Reviewers (Codex, Gemini, Claude) should focus on:

- Security: leaked secrets, missing row-level security, private data in `NEXT_PUBLIC_*`, unsafe API routes.
- Data loss: migrations that drop or rewrite data, offline sync conflicts, IndexedDB schema changes without upgrade path.
- Correctness against the linked issue's acceptance criteria.
- Changes to protected paths listed under Hard rules.

Do not comment on formatting or naming style; CI and the maintainer handle that.
