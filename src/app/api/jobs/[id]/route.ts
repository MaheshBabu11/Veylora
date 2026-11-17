import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, HttpError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    const result = await pool.query(
      "SELECT id, status, progress, total, error, created_at, updated_at FROM scan_jobs WHERE id = $1",
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, "Scan job not found.");
    return Response.json(result.rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get scan job");
  }
}
