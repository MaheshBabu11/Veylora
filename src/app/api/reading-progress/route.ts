import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const progressSchema = z.object({ chapterId: z.string().uuid(), page: z.number().int().positive() });

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT rp.series_id, rp.last_chapter_id, rp.last_page, rp.updated_at,
        c.chapter_number, m.title
       FROM reading_progress rp JOIN series m ON m.id = rp.series_id
       LEFT JOIN chapters c ON c.id = rp.last_chapter_id
       WHERE rp.user_id = 'local' ORDER BY rp.updated_at DESC`,
    );
    return Response.json(result.rows, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get reading progress");
  }
}

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const { chapterId, page } = progressSchema.parse(await readJson(request));
    await client.query("BEGIN");
    const chapter = await client.query("SELECT id, series_id, page_count FROM chapters WHERE id = $1", [chapterId]);
    if (!chapter.rowCount) throw new HttpError(404, "Chapter not found.");
    const chapterRow = chapter.rows[0];
    if (page > Number(chapterRow.page_count)) throw new HttpError(400, "Page is outside this chapter.");
    const previous = await client.query(
      "SELECT last_chapter_id FROM reading_progress WHERE user_id = 'local' AND series_id = $1 FOR UPDATE",
      [chapterRow.series_id],
    );
    await client.query(
      `INSERT INTO reading_progress(user_id, series_id, last_chapter_id, last_page, updated_at)
       VALUES ('local', $1, $2, $3, now())
       ON CONFLICT(user_id, series_id) DO UPDATE SET last_chapter_id = EXCLUDED.last_chapter_id,
         last_page = EXCLUDED.last_page, updated_at = now()`,
      [chapterRow.series_id, chapterId, page],
    );
    if (previous.rows[0]?.last_chapter_id !== chapterId) {
      await client.query(
        `INSERT INTO reading_history(user_id, series_id, chapter_id)
         SELECT 'local', $1, $2 WHERE NOT EXISTS (
           SELECT 1 FROM reading_history WHERE user_id = 'local' AND chapter_id = $2
             AND read_at > now() - interval '10 minutes'
         )`,
        [chapterRow.series_id, chapterId],
      );
    }
    await client.query("UPDATE series SET status = 'Reading', updated_at = now() WHERE id = $1 AND status = 'Plan to read'", [chapterRow.series_id]);
    await client.query("COMMIT");
    return Response.json({ seriesId: chapterRow.series_id, chapterId, page, updatedAt: new Date().toISOString() });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error, "save reading progress");
  } finally {
    client.release();
  }
}
