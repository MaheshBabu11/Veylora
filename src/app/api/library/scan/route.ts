import { z } from "zod";
import { pool } from "@/server/db";
import { apiError, readJson } from "@/server/http";
import { runLibraryScan } from "@/server/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    z.object({}).parse(body);
    const activeJob = await pool.query(
      "SELECT id, status FROM scan_jobs WHERE status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
    );
    if (activeJob.rowCount) return Response.json(activeJob.rows[0], { status: 202 });
    const result = await pool.query("INSERT INTO scan_jobs(status) VALUES ('queued') RETURNING id");
    const jobId = result.rows[0].id as string;
    setTimeout(() => {
      void runLibraryScan(jobId).catch(async (error: unknown) => {
        console.error("[scanner] scan job failed", error);
        await pool.query(
          "UPDATE scan_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1",
          [jobId, error instanceof Error ? error.message : "Unable to scan the library."],
        ).catch((updateError: unknown) => console.error("[scanner] failed to persist job error", updateError));
      });
    }, 0);
    return Response.json({ id: jobId, status: "queued" }, { status: 202 });
  } catch (error) {
    return apiError(error, "queue library scan");
  }
}
