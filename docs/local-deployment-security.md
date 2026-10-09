# Local configuration and public repository safety

## Deployment configuration

1. Keep `.env.local` only on the **Mac or deployment machine**. The browser / iPhone cannot read a local Node.js environment file.
2. Frontend environment variables with the `NEXT_PUBLIC_` prefix are **embedded into the JavaScript bundle**. They are not secrets, even when kept in an ignored file.
3. The browser may use the public backend URL and a **publishable** client key only. Enable row-level access policies for every exposed user-owned table.
4. Never put a service-role key, database password, private TLS key, or other credential in a `NEXT_PUBLIC_` variable, public Git repository, or browser storage.
5. Do not commit local user content, copyrighted material, exported user data, certificates, or private imports into a public code repository.
6. If any credential was ever committed, rotate it and review the repository's entire history; deleting a file in a new commit does not remove it from the old commits.
7. Use separate environment settings for local development and hosted deployment. Hosting the app on a public Git-backed platform requires a **server-side environment variable configuration** on the hosting provider; an environment file stored on a phone cannot configure it.
8. Offline use relies on preinstalled client assets and IndexedDB/Cache Storage, not a frontend environment file. Clearing site data deletes offline copies.

## Example local configuration

Copy the tracked `.env.example` to `.env.local`, then fill in your **public** configuration locally:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not commit `.env.local`. A file being ignored by Git is not encryption.
