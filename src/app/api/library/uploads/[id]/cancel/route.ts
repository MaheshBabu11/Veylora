import { z } from "zod";
import { getAuthenticatedUser } from "@/server/auth";
import { pool } from "@/server/db";
import { apiError, assertSameOrigin, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getAuthenticatedUser(request);
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    await readJson(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    const result = await pool.query(
      `UPDATE upload_jobs
       SET status = CASE WHEN status = 'failed' THEN 'queued' ELSE status END,
           cancel_requested = true,
           available_at = CASE WHEN status = 'failed' THEN now() ELSE available_at END,
           completed_at = NULL,
           updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running', 'failed')
       RETURNING id, status`,
      [id, user.id],
    );
    if (!result.rowCount) {
      const current = await pool.query<{ status: string }>(
        "SELECT status FROM upload_jobs WHERE id = $1 AND user_id = $2",
        [id, user.id],
      );
      if (!current.rowCount) throw new HttpError(404, "Upload job not found.");
      throw new HttpError(409, `The upload is already ${current.rows[0].status}.`);
    }
    return Response.json(result.rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "cancel archive upload");
  }
}
