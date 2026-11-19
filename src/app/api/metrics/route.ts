import { timingSafeEqual } from "node:crypto";
import { statfs } from "node:fs/promises";
import { pool } from "@/server/db";
import { getBooksRoot } from "@/server/filesystem";
import { apiError } from "@/server/http";
import { isLibraryScanWorkerStarted } from "@/server/library-scan-worker";
import { isLibraryUploadWorkerStarted } from "@/server/library-upload-worker";
import { isLibraryWatcherRunning } from "@/server/library-watcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEUE_STATUSES = ["queued", "running", "completed", "failed", "cancelled", "canceled", "other"] as const;
type QueueStatus = typeof QUEUE_STATUSES[number];
type QueueMetrics = { counts: Record<QueueStatus, number>; oldestQueuedSeconds: number };

function isAuthorized(request: Request, token: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const expectedBytes = Buffer.from(token);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

async function readQueueMetrics(table: "scan_jobs" | "upload_jobs"): Promise<QueueMetrics> {
  const [countsResult, oldestResult] = await Promise.all([
    pool.query<{ status: string; count: number }>(`SELECT status, count(*)::int AS count FROM ${table} GROUP BY status`),
    pool.query<{ seconds: number }>(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::int AS seconds
       FROM ${table} WHERE status = 'queued'`,
    ),
  ]);
  const counts = Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0])) as Record<QueueStatus, number>;
  for (const row of countsResult.rows) {
    const status = QUEUE_STATUSES.includes(row.status as QueueStatus) ? row.status as QueueStatus : "other";
    counts[status] += row.count;
  }
  return { counts, oldestQueuedSeconds: oldestResult.rows[0]?.seconds ?? 0 };
}

function appendQueueMetrics(lines: string[], queue: "scan" | "upload", metrics: QueueMetrics) {
  for (const status of QUEUE_STATUSES) {
    lines.push(`veylora_jobs{queue="${queue}",status="${status}"} ${metrics.counts[status]}`);
  }
  lines.push(`veylora_queue_oldest_queued_seconds{queue="${queue}"} ${metrics.oldestQueuedSeconds}`);
}

export async function GET(request: Request) {
  const token = process.env.VEYLORA_METRICS_TOKEN;
  if (!token) return new Response(null, { status: 404 });
  if (token.length < 32) return Response.json({ error: "Metrics access is not securely configured." }, { status: 503 });
  if (!isAuthorized(request, token)) return new Response(null, { status: 401 });

  try {
    let databaseAvailable = 0;
    let jobMetricsAvailable = 0;
    let scanQueue: QueueMetrics | undefined;
    let uploadQueue: QueueMetrics | undefined;
    try {
      await pool.query("SELECT 1");
      databaseAvailable = 1;
      [scanQueue, uploadQueue] = await Promise.all([
        readQueueMetrics("scan_jobs"),
        readQueueMetrics("upload_jobs"),
      ]);
      jobMetricsAvailable = 1;
    } catch (error) {
      console.error("[metrics] database or job metrics collection failed", error);
    }

    let booksDirectoryAvailable = 0;
    let diskAvailableBytes = 0;
    try {
      const booksRoot = await getBooksRoot();
      const disk = await statfs(booksRoot);
      diskAvailableBytes = Number(disk.bavail) * Number(disk.bsize);
      booksDirectoryAvailable = 1;
    } catch (error) {
      console.error("[metrics] books storage metrics collection failed", error);
    }

    const lines = [
      "# HELP veylora_service_up Whether the metrics endpoint is running.",
      "# TYPE veylora_service_up gauge",
      "veylora_service_up 1",
      "# HELP veylora_database_available Whether PostgreSQL responds to a query.",
      "# TYPE veylora_database_available gauge",
      `veylora_database_available ${databaseAvailable}`,
      "# HELP veylora_books_directory_available Whether the configured books directory is accessible.",
      "# TYPE veylora_books_directory_available gauge",
      `veylora_books_directory_available ${booksDirectoryAvailable}`,
      "# HELP veylora_job_metrics_available Whether durable job queue metrics were collected.",
      "# TYPE veylora_job_metrics_available gauge",
      `veylora_job_metrics_available ${jobMetricsAvailable}`,
      "# HELP veylora_worker_started Whether a background worker was started by this process.",
      "# TYPE veylora_worker_started gauge",
      `veylora_worker_started{worker="scan"} ${Number(isLibraryScanWorkerStarted())}`,
      `veylora_worker_started{worker="upload"} ${Number(isLibraryUploadWorkerStarted())}`,
      `veylora_worker_started{worker="filesystem_watcher"} ${Number(isLibraryWatcherRunning())}`,
      "# HELP veylora_books_storage_available_bytes Available bytes on the books filesystem.",
      "# TYPE veylora_books_storage_available_bytes gauge",
      `veylora_books_storage_available_bytes ${diskAvailableBytes}`,
      "# HELP veylora_jobs Number of durable jobs by queue and status.",
      "# TYPE veylora_jobs gauge",
      "# HELP veylora_queue_oldest_queued_seconds Age of the oldest queued job.",
      "# TYPE veylora_queue_oldest_queued_seconds gauge",
    ];
    if (scanQueue) appendQueueMetrics(lines, "scan", scanQueue);
    if (uploadQueue) appendQueueMetrics(lines, "upload", uploadQueue);

    return new Response(`${lines.join("\n")}\n`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, "metrics endpoint");
  }
}
