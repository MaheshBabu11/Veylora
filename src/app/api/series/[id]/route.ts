import { z } from "zod";
import { apiError, HttpError, readJson } from "@/server/http";
import { getSeries } from "@/server/repository";
import { pool } from "@/server/db";
import { metadataSlug } from "@/server/metadata";
import { SERIES_FORMATS } from "@/types/library";
import { getRequestUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const patchSchema = z.object({
  status: z.enum(["Reading", "Plan to read", "Completed", "On hold"]).optional(),
  favorite: z.boolean().optional(),
  featured: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  format: z.enum(SERIES_FORMATS).optional(),
  description: z.string().max(20_000).optional(),
  authorName: z.string().trim().max(160).optional(),
  genreIds: z.array(z.string().uuid()).max(32).optional(),
  coverChapterId: z.string().uuid().nullable().optional(),
  coverPageNumber: z.number().int().positive().max(100_000).nullable().optional(),
}).refine((value) => {
  const chapterSelected = value.coverChapterId !== undefined;
  const pageSelected = value.coverPageNumber !== undefined;
  return chapterSelected === pageSelected
    && (!chapterSelected || (value.coverChapterId === null) === (value.coverPageNumber === null));
}, "Select both a cover chapter and page, or clear both.")
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: userId } = getRequestUser(request);
    const { id } = paramsSchema.parse(await context.params);
    return Response.json(await getSeries(id, userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get series");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: userId } = getRequestUser(request);
    const { id } = paramsSchema.parse(await context.params);
    const patch = patchSchema.parse(await readJson(request));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query("SELECT id FROM series WHERE id = $1 FOR UPDATE", [id]);
      if (!exists.rowCount) throw new HttpError(404, "Title not found.");

      if (patch.coverChapterId) {
        const validCover = await client.query(
          "SELECT 1 FROM chapters WHERE id = $1 AND series_id = $2 AND page_count >= $3",
          [patch.coverChapterId, id, patch.coverPageNumber],
        );
        if (!validCover.rowCount) throw new HttpError(400, "The selected cover page does not exist in this title.");
      }

      const fields: string[] = [];
      const values: unknown[] = [id];
      const addField = (column: string, value: unknown) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };
      if (patch.title !== undefined) {
        addField("title", patch.title);
        addField("title_override", patch.title);
      }
      if (patch.format !== undefined) addField("format", patch.format);
      if (patch.featured !== undefined) addField("featured", patch.featured);
      if (patch.description !== undefined) addField("description", patch.description);
      if (patch.coverChapterId !== undefined) addField("cover_chapter_id", patch.coverChapterId);
      if (patch.coverPageNumber !== undefined) addField("cover_page_number", patch.coverPageNumber);
      if (fields.length) {
        await client.query(
          `UPDATE series SET ${fields.join(", ")}, updated_at = now() WHERE id = $1`,
          values,
        );
      }

      if (patch.status !== undefined || patch.favorite !== undefined) {
        await client.query(
          `INSERT INTO user_series(user_id, series_id, status, favorite)
           VALUES ($1, $2, COALESCE($3::varchar, 'Plan to read'), COALESCE($4::boolean, false))
           ON CONFLICT(user_id, series_id) DO UPDATE SET
             status = COALESCE($3::varchar, user_series.status),
             favorite = COALESCE($4::boolean, user_series.favorite),
             updated_at = now()`,
          [userId, id, patch.status ?? null, patch.favorite ?? null],
        );
      }

      if (patch.authorName !== undefined) {
        await client.query("DELETE FROM series_authors WHERE series_id = $1", [id]);
        if (patch.authorName) {
          const author = await client.query(
            `INSERT INTO authors(name, slug) VALUES ($1, $2)
             ON CONFLICT(slug) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [patch.authorName, metadataSlug(patch.authorName)],
          );
          await client.query("INSERT INTO series_authors(series_id, author_id) VALUES ($1, $2)", [id, author.rows[0].id]);
        }
      }

      if (patch.genreIds !== undefined) {
        const genreIds = Array.from(new Set(patch.genreIds));
        if (genreIds.length) {
          const foundGenres = await client.query("SELECT id FROM genres WHERE id = ANY($1::uuid[])", [genreIds]);
          if (foundGenres.rowCount !== genreIds.length) throw new HttpError(400, "One or more selected genres no longer exist.");
        }
        await client.query("DELETE FROM series_genres WHERE series_id = $1", [id]);
        if (genreIds.length) {
          const placeholders = genreIds.map((_, index) => `($1, $${index + 2})`).join(", ");
          await client.query(
            `INSERT INTO series_genres(series_id, genre_id) VALUES ${placeholders}`,
            [id, ...genreIds],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return Response.json(await getSeries(id, userId));
  } catch (error) {
    return apiError(error, "update series");
  }
}
