import { access } from "node:fs/promises";
import { pool } from "@/server/db";
import { apiError } from "@/server/http";
import { getConfiguredBooksRoot } from "@/server/filesystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    await access(getConfiguredBooksRoot());
    return Response.json({ status: "ok", database: "connected", booksDirectory: "available" });
  } catch (error) {
    return apiError(error, "health check");
  }
}
