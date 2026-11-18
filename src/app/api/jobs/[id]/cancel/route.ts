import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await readJson(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    const result = await pool.query<{ id: string; status: string }>(
      `UPDATE scan_jobs
       SET status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
           cancel_requested = true,
           completed_at = CASE WHEN status = 'queued' THEN now() ELSE completed_at END,
           updated_at = now()
       WHERE id = $1 AND status IN ('queued', 'running')
       RETURNING id, status`,
      [id],
    );
    if (!result.rowCount) {
      const current = await pool.query<{ status: string }>("SELECT status FROM scan_jobs WHERE id = $1", [id]);
      if (!current.rowCount) throw new HttpError(404, "Scan job not found.");
      throw new HttpError(409, `The scan is already ${current.rows[0].status}.`);
    }
    return Response.json(result.rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "cancel scan job");
  }
}
