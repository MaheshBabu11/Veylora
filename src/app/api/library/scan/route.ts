import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, readJson } from "@/server/http";
import { queueLibraryScan } from "@/server/library-scan-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT id, status, progress, total, error, created_at, updated_at
       FROM scan_jobs
       WHERE status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    return Response.json(result.rows[0] ?? null, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get active library scan");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    z.object({}).parse(body);
    const job = await queueLibraryScan();
    return Response.json({ id: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return apiError(error, "queue library scan");
  }
}
