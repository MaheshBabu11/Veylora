import { z } from "zod";
import { apiError } from "@/server/http";
import { getChapterPages } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; chapterId: string }> }) {
  try {
    const { id, chapterId } = z.object({ id: z.string().uuid(), chapterId: z.string().uuid() }).parse(await context.params);
    return Response.json(await getChapterPages(id, chapterId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list chapter pages");
  }
}
