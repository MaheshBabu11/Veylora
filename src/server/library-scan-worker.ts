import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { pool } from "./db";
import { runLibraryScan } from "./scanner";

const POLL_INTERVAL_MS = 1_500;
const HEARTBEAT_INTERVAL_MS = 30_000;
const LEASE_INTERVAL_MS = 5 * 60_000;

type ClaimedScanJob = {
  id: string;
};

const globalForWorker = globalThis as typeof globalThis & { veyloraScanWorkerStarted?: boolean };

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

async function claimNextScanJob(workerId: string): Promise<ClaimedScanJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE scan_jobs
       SET status = 'cancelled', worker_id = NULL, locked_at = NULL,
           completed_at = now(), updated_at = now()
       WHERE cancel_requested = true AND (
         status = 'queued'
         OR (status = 'running' AND (locked_at IS NULL OR locked_at < now() - ($1 * interval '1 millisecond')))
       )`,
      [LEASE_INTERVAL_MS],
    );
    await client.query(
      `UPDATE scan_jobs
       SET status = 'failed', error = COALESCE(error, 'The scan worker stopped before this job could be recovered.'),
           worker_id = NULL, locked_at = NULL, completed_at = now(), updated_at = now()
       WHERE status = 'running'
         AND cancel_requested = false
         AND (locked_at IS NULL OR locked_at < now() - ($1 * interval '1 millisecond'))
         AND attempts >= max_attempts`,
      [LEASE_INTERVAL_MS],
    );
    const result = await client.query<ClaimedScanJob>(
      `WITH next_job AS (
         SELECT id
         FROM scan_jobs
         WHERE cancel_requested = false
           AND attempts < max_attempts
           AND (
             (status = 'queued' AND available_at <= now())
             OR (status = 'running' AND (locked_at IS NULL OR locked_at < now() - ($2 * interval '1 millisecond')))
           )
         ORDER BY CASE WHEN status = 'queued' THEN 0 ELSE 1 END, available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE scan_jobs AS job
       SET status = 'running', worker_id = $1, locked_at = now(),
           attempts = job.attempts + 1, started_at = COALESCE(job.started_at, now()),
           error = NULL, updated_at = now()
       FROM next_job
       WHERE job.id = next_job.id
       RETURNING job.id`,
      [workerId, LEASE_INTERVAL_MS],
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finishScanJob(
  job: ClaimedScanJob,
  workerId: string,
  result: Awaited<ReturnType<typeof runLibraryScan>>,
) {
  const status = result.cancelled ? "cancelled" : result.errors.length ? "completed_with_errors" : "completed";
  await pool.query(
    `UPDATE scan_jobs
     SET status = $2, progress = CASE WHEN $5 THEN total ELSE progress END,
         error = $3, worker_id = NULL, locked_at = NULL, cancel_requested = false,
         completed_at = now(), updated_at = now()
     WHERE id = $1 AND worker_id = $4 AND status = 'running'`,
    [job.id, status, result.cancelled ? null : result.errorSummary, workerId, !result.cancelled],
  );
}

async function failScanJob(job: ClaimedScanJob, workerId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : "Unable to scan the library.").slice(0, 10_000);
  await pool.query(
    `UPDATE scan_jobs
     SET status = CASE
           WHEN cancel_requested THEN 'cancelled'
           WHEN attempts >= max_attempts THEN 'failed'
           ELSE 'queued'
         END,
         available_at = CASE WHEN attempts >= max_attempts
           THEN available_at
           ELSE now() + (LEAST(60, 5 * power(2, GREATEST(attempts - 1, 0)))::text || ' seconds')::interval
         END,
         error = CASE WHEN cancel_requested THEN NULL ELSE $2 END,
         worker_id = NULL, locked_at = NULL,
         completed_at = CASE WHEN cancel_requested OR attempts >= max_attempts THEN now() ELSE NULL END,
         updated_at = now()
     WHERE id = $1 AND worker_id = $3 AND status = 'running'`,
    [job.id, message, workerId],
  );
}

async function runClaimedJob(job: ClaimedScanJob, workerId: string) {
  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE scan_jobs SET locked_at = now(), updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [job.id, workerId],
    ).catch((error: unknown) => console.error("[scanner] could not renew scan job lease", { jobId: job.id, error }));
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    const result = await runLibraryScan(job.id, workerId);
    await finishScanJob(job, workerId, result);
  } catch (error) {
    console.error("[scanner] scan job attempt failed", { jobId: job.id, error });
    await failScanJob(job, workerId, error);
  } finally {
    clearInterval(heartbeat);
    await pool.query(
      `UPDATE library_directories SET status = 'active'
       WHERE id = (SELECT directory_id FROM scan_jobs WHERE id = $1) AND status = 'scanning'`,
      [job.id],
    ).catch((error: unknown) => console.error("[scanner] could not restore library directory status", { jobId: job.id, error }));
  }
}

async function workerLoop(workerId: string) {
  while (true) {
    try {
      const job = await claimNextScanJob(workerId);
      if (job) {
        await runClaimedJob(job, workerId);
        continue;
      }
    } catch (error) {
      console.error("[scanner] scan worker could not claim a job", error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function startLibraryScanWorker() {
  if (globalForWorker.veyloraScanWorkerStarted) return;
  globalForWorker.veyloraScanWorkerStarted = true;
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  void workerLoop(workerId);
  console.info("[scanner] durable scan worker started", { workerId });
}

export function isLibraryScanWorkerStarted() {
  return globalForWorker.veyloraScanWorkerStarted === true;
}
