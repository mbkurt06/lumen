# Content Workspace

A configurable offline-first content, practice, scheduling and media application.

## Technology

- Next.js / React / TypeScript
- PostgreSQL, authentication and sync via Supabase
- IndexedDB and Cache Storage for offline data
- Service Worker and installable Progressive Web App
- Optional calendar and remote content-provider integrations

## Local setup

1. Copy `.env.example` into `.env.local` and configure your environment.
2. Run `npm install`.
3. Run `npm run dev` for development, or `npm run build && npm run start` for deployment.
4. Use HTTPS for PWA installation on devices other than localhost.

## Configuration rules

- All real documents, user content and account-specific settings belong in the database or local device stores, not the source repository.
- The tracked `.env.example` contains placeholders only.
- The local `.env.local` must not be committed.
- `NEXT_PUBLIC_*` variables are compiled into the browser bundle and are never secret.
- Private credentials and access tokens belong on the server only.
- Frontend data access must be protected using row-level security.
- An offline browser has no access to a server-side ENV file; it uses cached settings and IndexedDB.

See `docs/local-deployment-security.md` for details.

## Deployment note

A public Git repository stores source code; it does not by itself serve an always-on Next.js server. Use an application hosting environment with server-side environment variables for full API route functionality.

## Deployment

Pushes to the default branch are intended to trigger connected hosting-provider builds. Configure environment variables in the hosting dashboard before publishing.
