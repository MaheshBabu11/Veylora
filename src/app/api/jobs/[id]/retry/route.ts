import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = await pool.connect();
  try {
    await readJson(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734210, 1)");
    const activeJob = await client.query(
      "SELECT id FROM scan_jobs WHERE status IN ('queued', 'running') LIMIT 1",
    );
    if (activeJob.rowCount) throw new HttpError(409, "Another library scan is already queued or running.");
    const result = await client.query<{ id: string; status: string }>(
      `UPDATE scan_jobs
       SET status = 'queued', progress = 0, total = 0, error = NULL,
           attempts = 0, available_at = now(), worker_id = NULL, locked_at = NULL,
           cancel_requested = false, started_at = NULL, completed_at = NULL, directory_id = NULL,
           updated_at = now()
       WHERE id = $1 AND status IN ('failed', 'completed_with_errors', 'cancelled')
       RETURNING id, status`,
      [id],
    );
    if (!result.rowCount) {
      const current = await client.query<{ status: string }>("SELECT status FROM scan_jobs WHERE id = $1", [id]);
      if (!current.rowCount) throw new HttpError(404, "Scan job not found.");
      throw new HttpError(409, `A scan cannot be retried while it is ${current.rows[0].status}.`);
    }
    await client.query("COMMIT");
    return Response.json(result.rows[0], { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error, "retry scan job");
  } finally {
    client.release();
  }
}
