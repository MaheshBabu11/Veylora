import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, assertSameOrigin, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bookmarkSchema = z.object({
  seriesId: z.string().uuid(),
  chapterId: z.string().uuid().optional(),
  pageNumber: z.number().int().positive().optional(),
  note: z.string().max(2000).default(""),
});

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT b.id, b.series_id, b.chapter_id, b.page_number, b.note, b.created_at,
        m.title, c.chapter_number FROM bookmarks b JOIN series m ON m.id = b.series_id
       LEFT JOIN chapters c ON c.id = b.chapter_id WHERE b.user_id = 'local' ORDER BY b.created_at DESC`,
    );
    return Response.json(result.rows, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list bookmarks");
  }
}

export async function POST(request: Request) {
  try {
    const bookmark = bookmarkSchema.parse(await readJson(request));
    if (bookmark.chapterId) {
      const chapter = await pool.query("SELECT 1 FROM chapters WHERE id = $1 AND series_id = $2", [bookmark.chapterId, bookmark.seriesId]);
      if (!chapter.rowCount) throw new HttpError(400, "The chapter does not belong to this title.");
    }
    const result = await pool.query(
      `INSERT INTO bookmarks(user_id, series_id, chapter_id, page_number, note)
       VALUES ('local', $1, $2, $3, $4) RETURNING id, series_id, chapter_id, page_number, note, created_at`,
      [bookmark.seriesId, bookmark.chapterId ?? null, bookmark.pageNumber ?? null, bookmark.note],
    );
    return Response.json(result.rows[0], { status: 201 });
  } catch (error) {
    return apiError(error, "create bookmark");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const result = await pool.query("DELETE FROM bookmarks WHERE id = $1 AND user_id = 'local'", [id]);
    if (!result.rowCount) throw new HttpError(404, "Bookmark not found.");
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error, "delete bookmark");
  }
}
