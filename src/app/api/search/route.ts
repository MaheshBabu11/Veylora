import { z } from "zod";
import { apiError } from "@/server/http";
import { listSeries } from "@/server/repository";
import { getRequestUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { id: userId } = getRequestUser(request);
    const query = z.string().trim().min(1).max(200).parse(new URL(request.url).searchParams.get("q"));
    return Response.json(await listSeries({ userId, query, limit: 30 }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "search library");
  }
}
