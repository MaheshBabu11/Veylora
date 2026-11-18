import { pool } from "@/server/db";
import { apiError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT id, status, progress, total, error, attempts, max_attempts, cancel_requested,
              created_at, updated_at, started_at, completed_at
       FROM scan_jobs
       ORDER BY created_at DESC
       LIMIT 20`,
    );
    return Response.json({ items: result.rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get scan job history");
  }
}
