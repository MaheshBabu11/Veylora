import { z } from "zod";
import { pool } from "@/server/db";
import { readArchiveImage } from "@/server/archive";
import { apiError, HttpError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; chapterId: string; pageNumber: string }> }) {
  try {
    const { id, chapterId, pageNumber: rawPage } = await context.params;
    const seriesId = z.string().uuid().parse(id);
    const chapter = z.string().uuid().parse(chapterId);
    const pageNumber = z.coerce.number().int().positive().parse(rawPage);
    const result = await pool.query(
      `SELECT c.source_path, p.archive_entry FROM chapters c
       JOIN chapter_pages p ON p.chapter_id = c.id
       WHERE c.id = $1 AND c.series_id = $2 AND p.page_number = $3`,
      [chapter, seriesId, pageNumber],
    );
    if (!result.rowCount) throw new HttpError(404, "Page not found.");
    const page = await readArchiveImage(result.rows[0].source_path as string, result.rows[0].archive_entry as string);
    const extension = (result.rows[0].archive_entry as string).split(".").at(-1)?.toLowerCase();
    const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "avif" ? "image/avif" : extension === "gif" ? "image/gif" : "image/jpeg";
    return new Response(page, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return apiError(error, "serve chapter page");
  }
}
