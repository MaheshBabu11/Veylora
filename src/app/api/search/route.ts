import { z } from "zod";
import { apiError } from "@/server/http";
import { listSeries } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = z.string().trim().min(1).max(200).parse(new URL(request.url).searchParams.get("q"));
    return Response.json(await listSeries({ query, limit: 30 }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "search library");
  }
}
