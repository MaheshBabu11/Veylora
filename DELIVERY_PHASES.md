# Veylora Delivery Phases

Status reflects implementation and verification in the current local environment. A feature is not called complete merely because code exists; the relevant acceptance check must also be verified.

## Phase 1 — Foundation: Complete

- Next.js App Router, strict TypeScript, shared module layout, Zustand, and lint/typecheck commands are in place.

## Phase 2 — Frontend: Complete

- Responsive shell, design tokens, theme support, library/detail/reader/settings routes, and shared UI components are implemented.
- Screens consume the API-backed library model rather than the original mock catalogue.

## Phase 3 — Database and API: Implemented; runtime verification pending

- PostgreSQL schema and migrations `0001_initial.sql` through `0008_series_format.sql` are included in the repository.
- Drizzle schema definitions, a `pg` connection pool, migration runner, API handlers, and parameterized repository queries are present.
- Library, chapters/pages, search, progress, preferences, collections, bookmarks, scan jobs, directories, storage, cache, and health endpoints are implemented.
- **Pending:** app-runtime API smoke tests and representative CRUD/error-path tests against a configured local database.

## Phase 4 — Filesystem and archives: Partial

- The configured books root is canonicalized and constrained; archive pages are read in place rather than extracted to arbitrary paths.
- `.cbz` and `.zip` page enumeration, lazy page serving, and a bounded on-disk cache are implemented.
- The top-bar Import dialog can upload up to 100 CBZ/ZIP archives per request, assign a series title and unique chapter numbers, optionally save author/description/genre details, reject overwrites, and queue library indexing.
- Series details are editable, user-defined genres can be assigned to series, and custom cover images can be uploaded alongside the series archives.
- **Pending:** indexing those existing files from the app runtime, CBR/RAR support, image thumbnail processing, watcher/import workflows, and a durable worker with cancellation/retry. Scan jobs currently execute in the Next.js process and may not survive a restart.

## Phase 5 — Persistence: Partial

- Reading progress/history, preferences, bookmarks, favorites, and collections have database-backed API paths and UI wiring.
- **Pending:** comprehensive persistence and error-path tests, export/retention controls, offline edits, and cross-device synchronization.

## Phase 6 — API integration: Partial

- TanStack Query provider and API service/hooks are integrated into the main library, detail, dashboard, reader, and settings views.
- **Pending:** complete route coverage, optimistic updates with rollback, consistent error boundaries, and offline synchronization.

## Phase 7 — Testing and hardening: Not complete

- `npm run typecheck`, `npm run lint`, and the optimized production build pass.
- A guarded `npm run db:reset -- --confirm` script clears application tables, restores default local preferences, and preserves migrations; it is not run automatically.
- **Pending verification:** 10k-title and 100k-item benchmarks, query and network baselines, API integration/error/concurrency tests, security review, load tests, Lighthouse score, production monitoring, and deployment runbook.
- Build output still needs to be checked for deployment-specific filesystem tracing and runtime configuration.

## Acceptance criteria still open

- Scan the configured library and confirm the resulting series/chapter/page counts and reader rendering.
- Verify health, preferences, search, progress, collections, bookmarks, and page-serving endpoints against the running app.
- Add durable job execution and failure recovery before relying on long scans in production.
- Run the Phase 7 benchmarks and security/performance checks; do not claim production readiness until they pass.

## Future work

Mobile/desktop clients, cloud sync, sharing, social/discovery features, recommendations, and advanced statistics remain out of scope for the current delivery.
