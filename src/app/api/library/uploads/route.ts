import { getAuthenticatedUser } from "@/server/auth";
import { pool } from "@/server/db";
import { apiError, HttpError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    const result = await pool.query(
      `SELECT job.id, job.status, job.progress, job.total, job.error, job.attempts,
              job.max_attempts, job.cancel_requested, job.created_at, job.updated_at, job.completed_at,
              COALESCE(job.payload->>'seriesTitle', series.title) AS series_title,
              jsonb_array_length(job.payload->'chapters') AS chapter_count
       FROM upload_jobs AS job
       LEFT JOIN series ON series.id::text = job.payload->>'seriesId'
       WHERE job.user_id = $1
       ORDER BY job.created_at DESC
       LIMIT 20`,
      [user.id],
    );
    return Response.json({ items: result.rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get archive upload history");
  }
}
