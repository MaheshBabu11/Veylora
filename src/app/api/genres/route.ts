import { z } from "zod";
import { apiError, readJson } from "@/server/http";
import { pool } from "@/server/db";
import { metadataSlug } from "@/server/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createGenreSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.slug, count(mg.series_id)::int AS series_count
       FROM genres g
       LEFT JOIN series_genres mg ON mg.genre_id = g.id
       GROUP BY g.id
       ORDER BY lower(g.name), g.name`,
    );
    return Response.json(result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      seriesCount: Number(row.series_count),
    })), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list genres");
  }
}

export async function POST(request: Request) {
  try {
    const { name } = createGenreSchema.parse(await readJson(request));
    const result = await pool.query(
      `INSERT INTO genres(name, slug) VALUES ($1, $2)
       ON CONFLICT(slug) DO UPDATE SET name = genres.name
       RETURNING id, name, slug`,
      [name, metadataSlug(name)],
    );
    const row = result.rows[0];
    const count = await pool.query("SELECT count(*)::int AS series_count FROM series_genres WHERE genre_id = $1", [row.id]);
    return Response.json({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      seriesCount: Number(count.rows[0].series_count),
    }, { status: 201 });
  } catch (error) {
    return apiError(error, "create genre");
  }
}
