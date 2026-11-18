import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, HttpError, readJson } from "@/server/http";
import { getRequestUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  seriesIds: z.array(z.string().uuid()).max(500).default([]),
});

export async function GET(request: Request) {
  try {
    const { id: userId } = getRequestUser(request);
    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_at,
        COALESCE(array_agg(cm.series_id) FILTER (WHERE cm.series_id IS NOT NULL), ARRAY[]::uuid[]) AS series_ids
       FROM collections c LEFT JOIN collection_series cm ON cm.collection_id = c.id
       WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.created_at DESC`,
      [userId],
    );
    return Response.json(result.rows, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list collections");
  }
}

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const { id: userId } = getRequestUser(request);
    const { name, description, seriesIds } = createCollectionSchema.parse(await readJson(request));
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO collections(user_id, name, description) VALUES ($1, $2, $3)
       ON CONFLICT(user_id, name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id, name, description, created_at`,
      [userId, name, description],
    );
    const collection = result.rows[0];
    for (const seriesId of seriesIds) {
      const exists = await client.query("SELECT 1 FROM series WHERE id = $1", [seriesId]);
      if (!exists.rowCount) throw new HttpError(404, "A selected title was not found.");
      await client.query(
        "INSERT INTO collection_series(collection_id, series_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [collection.id, seriesId],
      );
    }
    await client.query("COMMIT");
    return Response.json({ ...collection, series_ids: seriesIds }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error, "create collection");
  } finally {
    client.release();
  }
}
