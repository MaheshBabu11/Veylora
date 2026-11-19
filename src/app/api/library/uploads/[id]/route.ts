import { z } from "zod";
import { getAuthenticatedUser } from "@/server/auth";
import { pool } from "@/server/db";
import { apiError, HttpError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    const result = await pool.query(
      `SELECT job.id, job.status, job.progress, job.total, job.error, job.attempts,
              job.max_attempts, job.cancel_requested, job.created_at, job.updated_at, job.completed_at,
              COALESCE(job.payload->>'seriesTitle', series.title) AS series_title,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'chapterNumber', (chapter->>'chapterNumber')::integer,
                  'fileName', 'Chapter ' || lpad(chapter->>'chapterNumber', 3, '0') || (chapter->>'extension')
                ))
                FROM jsonb_array_elements(job.payload->'chapters') AS chapter
              ), '[]'::jsonb) AS uploaded
       FROM upload_jobs AS job
       LEFT JOIN series ON series.id::text = job.payload->>'seriesId'
       WHERE job.id = $1 AND job.user_id = $2`,
      [id, user.id],
    );
    if (!result.rowCount) throw new HttpError(404, "Upload job not found.");
    return Response.json(result.rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get archive upload status");
  }
}
