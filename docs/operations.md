# Database Backup, Restore, and Migration Recovery

## Database backups

Install the PostgreSQL client tools (`pg_dump` and `pg_restore`) at a version equal to or newer than the database server. Set `DATABASE_URL` in `.env.local` or the process environment.

Create a compressed, custom-format database backup:

```sh
npm run db:backup
```

By default, the dump is written under the ignored `backups/` directory with restrictive file permissions. An explicit output path can be supplied:

```sh
npm run db:backup -- /secure-backups/veylora.dump
```

Database dumps do not include the archive files. Back up the entire `VEYLORA_BOOKS_DIR` separately and coordinate the two backups so that the database and archive tree represent the same point in time. Keep both copies on storage that survives loss of the application host.

## Restore

Restore requires an explicit confirmation flag and is restricted to the local `books` database. It drops and recreates database objects from the dump, and the restore runs as one transaction so a failed restore does not leave a partial schema:

```sh
npm run db:restore -- backups/veylora-YYYY-MM-DDTHH-MM-SSZ.dump --confirm
```

Restore the matching `VEYLORA_BOOKS_DIR` snapshot as well. Stop the application and its scan/upload workers before restoring either side. Afterward, run `npm run db:migrate`, start the application, and verify the library scan and reader before accepting traffic.

## Migration failure and recovery

`npm run db:migrate` applies each numbered SQL migration and records its filename in `_veylora_migrations` in the same PostgreSQL transaction. If a migration fails, that migration's DDL and history entry roll back together; preserve the error output, fix the underlying cause, and rerun the migration command. Do not manually mark a failed migration as applied.

Before deploying a migration that changes or removes data, take a database backup and a matching archive-directory backup. If a committed migration causes an unrecoverable issue, stop workers, restore both pre-migration backups using the procedure above, then deploy a corrected forward migration. Do not edit an already-applied migration to attempt a rollback; migration history is append-only.

## Integration tests

`npm run test:integration` requires `DATABASE_URL` (including credentials if required) for the local `books` database, with the application's migrations already applied. The test runner creates a uniquely named temporary PostgreSQL schema and fresh temporary books and cache directories, runs the API workflows in that isolated setup, then removes them. The tests refuse non-local database hosts or a database name other than `books`; no real archive files or cache entries are read or changed. The archive-image test also requires the system `zip` and `unzip` utilities.

Run `npm run benchmark:library` to measure the repository's paginated title listing, full-text search, and chapter-count sorting against 5,000 generated series and 25,000 generated chapters. It runs three warmups and 30 measured requests per query in the same disposable schema used by integration tests, reports p50/p95 response times, and does not read or alter the real books directory or persistent database schema. Treat the results as a local baseline, not a multi-user capacity guarantee; benchmark on hardware and database settings similar to deployment before changing query or index behavior.

## Runtime and deployment

Veylora requires a long-running Node.js server, not an Edge or serverless runtime. The Node process starts the scan worker, upload worker, and filesystem watcher through Next.js instrumentation. Keep the process running and give it access to the same PostgreSQL database and persistent archive/cache directories on every restart. Use a single application instance for a local installation; additional instances also start filesystem watchers and background workers.

For a deployment, install the locked dependencies, configure `.env.local` or the service environment, then apply migrations and build the app:

```sh
npm ci
npm run db:migrate
npm run build
npm run start
```

Set `DATABASE_URL`, `VEYLORA_BOOKS_DIR`, and `VEYLORA_CACHE_DIR` to the intended production values. Ensure the Node service account can read and write the books and cache directories, and that PostgreSQL connection limits account for `DATABASE_POOL_SIZE` per application process. Keep `.env.local` and database credentials out of source control and build logs. Veylora has open account registration and no administrator or invitation controls; keep it on a trusted network and do not expose it directly to the public internet.

Before a migration that changes or removes data, take coordinated database and archive backups. Schedule a maintenance window, stop the application before restoring data, and restart it only after both snapshots are restored. A deployment health check should request `/api/health` from the application host: HTTP 200 confirms PostgreSQL responds to a query and the configured books directory is accessible. For Prometheus scraping, set `VEYLORA_METRICS_TOKEN` to a randomly generated secret of at least 32 characters (for example, `openssl rand -hex 32`) and provide it as a bearer token. Without the token, `/api/metrics` is hidden; an invalid or too-short token is rejected. The endpoint exposes dependency status, worker-started indicators, durable queue counts and oldest queued age, and free bytes on the books filesystem. Do not expose the token in source control or scrape it over an untrusted network.

The ready-to-import alert rules are in `monitoring/veylora-alerts.yml`. Configure Prometheus to scrape `/api/metrics` with the bearer token, then load those rules into its rule files. They alert on a down process, PostgreSQL or books-storage unavailability, workers that have not started, missing job metrics, jobs queued for over five minutes, and books-disk space below 5 GiB. A worker-started gauge is a process startup indicator, not a heartbeat; also monitor job queue age and preserve service logs. `/api/health` remains a lightweight unauthenticated readiness probe and does not expose queue details.

## Logs and job monitoring

The application writes operational messages to stdout/stderr. Preserve those streams in the service manager or container logs. API failures use the `[api]` prefix; scan worker/watcher messages use `[scanner]`; upload worker messages use `[upload]`. Worker errors include job IDs when available, which can be matched against the scan or upload history in Settings. Repeated claim/lease errors, jobs that repeatedly return to `queued`, or jobs ending in `failed` warrant investigation; retry a failed job from Settings only after correcting its underlying cause.

Workers poll PostgreSQL queues every 1.5 seconds and renew running-job leases every 30 seconds. A worker abandoned by a process crash can be reclaimed after its five-minute lease expires, and both job types allow up to three attempts with backoff. Upload bytes are received and staged by the upload request; validation, promotion, and indexing are processed asynchronously by the upload worker. Do not treat HTTP acceptance as proof that a job completed—check its final status.

## Troubleshooting

| Symptom | Checks and recovery |
| --- | --- |
| `/api/health` returns an error | Check PostgreSQL availability and `DATABASE_URL`; verify the service account can access `VEYLORA_BOOKS_DIR`. Inspect the API log for the operation failure. |
| Jobs remain queued | Confirm the long-running Node process started and inspect logs for `[scanner]` or `[upload]` worker startup and claim errors. Verify migrations are applied and PostgreSQL is reachable. |
| Scan or upload job fails | Match the job ID in Settings with worker logs, correct the archive, path, or permission problem, then retry from Settings. Repeated retries without fixing the cause will consume the attempt limit. |
| Automatic library changes are not detected | Confirm automatic scanning is enabled in Settings and that the Node process can watch the books directory; use a manual scan while investigating watcher errors. |
| Cache consumes disk space or serves stale data | The extracted-page and responsive WebP derivative cache share a 4 GiB cap and are pruned by least-recent access. Use the Settings cache action to clear both; this does not remove original archives. Animated GIF pages continue to use their original image data. |
| Database recovery is needed | Follow the restore procedure above and restore the matching books-directory snapshot. Never restore only one side of the database/archive pair. |
