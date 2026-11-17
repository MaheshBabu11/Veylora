import { z } from "zod";
import { apiError } from "@/server/http";
import { listChapters } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    return Response.json(await listChapters(id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list chapters");
  }
}
