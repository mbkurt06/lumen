# Lumen

Lumen is a cross-platform personal library, reading, listening, memorization, and task application.

## Platforms

Lumen is a web/PWA application. The same codebase is designed to run on:

- iPhone / iPad
- macOS
- Android
- Windows
- Any modern browser

No Apple Developer membership is required for normal web/PWA use.

## Architecture

- Next.js + TypeScript
- React
- Progressive Web App (PWA)
- Supabase PostgreSQL as the central database
- Supabase Auth for user identity
- Supabase Realtime for synchronized changes
- IndexedDB for offline/local cache

## Data policy

The public GitHub repository contains application code and generic database schema only.

It must not contain real library titles, book names, religious text, imported document text, personal notes, tasks, memorization progress, YouTube segment timings, or user data.

All real content is stored in the central database under the authenticated user account.

## Content model

The content model is intentionally generic and recursive.

```
Library
└── Collection / Folder / Document
    └── Content node
        ├── volume
        ├── part
        ├── chapter
        ├── section
        ├── page
        ├── heading
        ├── paragraph
        ├── sentence
        ├── phrase
        ├── verse
        └── custom
```

The same document can therefore use only the hierarchy it needs.

## Media model

External media is referenced rather than duplicated.

For example, a video can be stored once as:

- provider
- external video ID / URL
- reusable time segments

All devices read the same segment boundaries from the database.

## Synchronization

Reading state, memorization state, todos, media timings, preferences, and content metadata are centralized so a change made on one device appears on the others.

IndexedDB will provide an offline cache and a queue for changes made while offline.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and public anon key.
3. Run the SQL migration in `supabase/migrations`.
4. Install dependencies with `npm install`.
5. Start with `npm run dev`.

No production secrets should ever be committed to this repository.
