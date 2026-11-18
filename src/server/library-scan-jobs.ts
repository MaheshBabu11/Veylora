import { pool } from "./db";

export type LibraryScanJob = {
  id: string;
  status: string;
  createdAt: Date;
};

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

  return { ...job, created };
}
