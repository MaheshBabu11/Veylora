import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, HttpError } from "@/server/http";
import { getSeries } from "@/server/repository";
import { getRequestUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: userId } = getRequestUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    const result = await pool.query(
      `SELECT c.id, c.series_id, c.chapter_number, c.title, c.page_count, rp.last_page
       FROM chapters c LEFT JOIN reading_progress rp ON rp.last_chapter_id = c.id AND rp.user_id = $2
       WHERE c.id = $1`,
      [id, userId],
    );
    if (!result.rowCount) throw new HttpError(404, "Chapter not found.");
    const chapter = result.rows[0];
    return Response.json({ ...chapter, series: await getSeries(chapter.series_id as string, userId) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "get chapter");
  }
}
