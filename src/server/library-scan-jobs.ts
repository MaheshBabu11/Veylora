import { pool } from "./db";
import { runLibraryScan } from "./scanner";

export type LibraryScanJob = {
  id: string;
  status: string;
  createdAt: Date;
};

function startLibraryScan(jobId: string) {
  setTimeout(() => {
    void runLibraryScan(jobId).catch(async (error: unknown) => {
      console.error("[scanner] scan job failed", error);
      await pool.query(
        "UPDATE scan_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1",
        [jobId, error instanceof Error ? error.message : "Unable to scan the library."],
      ).catch((updateError: unknown) => console.error("[scanner] failed to persist job error", updateError));
    });
  }, 0);
}

export async function queueLibraryScan() {
  const client = await pool.connect();
  let job: LibraryScanJob;
  let created = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734210, 1)");
    const activeJob = await client.query<LibraryScanJob>(
      `SELECT id, status, created_at AS "createdAt"
       FROM scan_jobs
       WHERE status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    if (activeJob.rowCount) {
      job = activeJob.rows[0];
    } else {
      const result = await client.query<LibraryScanJob>(
        `INSERT INTO scan_jobs(status)
         VALUES ('queued')
         RETURNING id, status, created_at AS "createdAt"`,
      );
      job = result.rows[0];
      created = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (created) startLibraryScan(job.id);
  return { ...job, created };
}
