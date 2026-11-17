# Veylora

Veylora is a local-first library and reader for manga, manhwa, manhua, webtoons, and comics. It keeps archive files on your filesystem and uses PostgreSQL for series metadata, reading progress, preferences, bookmarks, collections, and library scan records.

> **Project status:** Veylora is under active development and is intended for trusted local use. It does not currently provide user authentication, offline mutation sync, or durable background workers. Do not expose it directly to the public internet.

## Features

- Import and organize CBZ, ZIP, and CBR chapters, with chapter numbers supplied by the user.
- Browse and search series, edit metadata and formats, assign genres, and upload covers.
- Read chapters in vertical or single-page mode, with reading progress saved locally.
- Organize favorites and collections, and manage appearance and reader preferences.
- Automatically detect added or updated archives and queue library indexing; automatic scanning can be disabled in Settings.
- Keep original archives in a configurable directory; serve pages on demand and cache them locally.
- Track scans and view library and cache storage usage.

## Technology

- Next.js App Router, React, and TypeScript
- PostgreSQL with `pg` and Drizzle schema definitions
- TanStack Query for client-side API data
- Zod for request validation

## Requirements

- Node.js 20.9 or newer
- npm 10 or newer
- PostgreSQL (the configured database must exist before running migrations)
- A directory for your CBZ/ZIP/CBR archives

## Getting started

1. Clone the repository and install dependencies:

   ```sh
   git clone <repository-url>
   cd Veylora
   npm install
   ```

2. Create your local environment file and set the database URL and archive directory:

   ```sh
   cp .env.example .env.local
   ```

   Edit `.env.local` with your own PostgreSQL credentials and paths. **Never commit `.env.local` or real credentials.**

3. Apply database migrations and start the development server:

   ```sh
   npm run db:migrate
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000). The `/api/health` endpoint checks database connectivity and that the configured archive directory is available.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Recommended | `postgresql://localhost:5432/books` | PostgreSQL connection string. Set credentials in `.env.local`. |
| `VEYLORA_BOOKS_DIR` | No | `/mnt/data/Docker/books` | Directory containing uploaded and existing archives. |
| `VEYLORA_CACHE_DIR` | No | `./storage/cache` | On-disk cache for pages served from archives. |
| `DATABASE_POOL_SIZE` | No | `10` | Maximum PostgreSQL connections in the application pool. |

The application expects the PostgreSQL database to be created in advance. `npm run db:migrate` applies the SQL files in `drizzle/migrations`.

## Archive storage

Uploads are stored under `VEYLORA_BOOKS_DIR`, grouped by series and named with the chapter number, for example:

```text
<VEYLORA_BOOKS_DIR>/
  The Example Series/
    Chapter 001.cbz
    Chapter 002.zip
    Chapter 003.cbr
```

The import dialog accepts up to 100 CBZ, ZIP, or CBR archives per request (up to 2 GiB per archive and 4 GiB total per request). Existing files are not overwritten. Supported page images include JPG/JPEG, PNG, WebP, AVIF, and GIF. CBR reading uses `node-unrar-js`; multi-volume RAR archives are not supported.

Original archives remain in the configured books directory. Veylora reads pages on demand rather than extracting archives to arbitrary locations. The cache can be cleared from the app's settings.

## Useful commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Run type checking and linting, then create a production build. |
| `npm run start` | Serve the production build. |
| `npm run typecheck` | Run the TypeScript compiler without emitting files. |
| `npm run lint` | Run ESLint. |
| `npm run db:migrate` | Apply unapplied database migrations. |
| `npm run db:reset -- --confirm` | Destructively reset application data in the local `books` database. |

The database reset command requires the explicit `--confirm` flag, refuses non-local databases and active scans, preserves schema and migration history, and does not delete archive files. Back up your database before using it.

## Project layout

```text
src/
  app/                 Pages and API route handlers
  components/          Library, reader, settings, and shared UI
  services/            API clients and query hooks
  server/              Database, repositories, archive, and filesystem logic
  stores/              Client-side preference state
  types/               Shared domain types
drizzle/migrations/    PostgreSQL migrations
scripts/               Migration and local reset scripts
```

## Current limitations

- The app uses a single local profile and has no authentication or multi-user access controls.
- Scan jobs run in the Next.js process and may not survive process termination.
- Offline changes, cross-device synchronization, and automated conflict resolution are not implemented.
- Image thumbnail generation and production-scale performance/security validation remain outstanding.

See [CHECKLIST.md](CHECKLIST.md) and [DELIVERY_PHASES.md](DELIVERY_PHASES.md) for implementation and remaining verification work. No license has been selected for this repository yet.
