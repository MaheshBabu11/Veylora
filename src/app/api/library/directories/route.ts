import { pool } from "@/server/db";
import { apiError } from "@/server/http";
import { getConfiguredBooksRoot } from "@/server/filesystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(
      "SELECT id, path, status, last_scanned_at FROM library_directories ORDER BY created_at",
    );
    if (!result.rowCount) {
      return Response.json([{ path: getConfiguredBooksRoot(), status: "not_scanned", last_scanned_at: null }]);
    }
    return Response.json(result.rows, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list library directories");
  }
}
