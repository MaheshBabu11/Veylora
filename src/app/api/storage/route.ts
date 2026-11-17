import { getStorageStats } from "@/server/filesystem";
import { apiError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getStorageStats(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get storage stats");
  }
}
