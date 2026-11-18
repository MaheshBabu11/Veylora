import { z } from "zod";
import { apiError } from "@/server/http";
import { listSeries } from "@/server/repository";
import { getRequestUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["Reading", "Plan to read", "Completed", "On hold"]).optional(),
  genre: z.string().max(80).optional(),
  featured: z.enum(["true", "false"]).optional(),
  sort: z.enum(["recent", "updated", "title", "last-read"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  try {
    const { id: userId } = getRequestUser(request);
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const result = await listSeries({
      userId,
      query: parsed.q,
      status: parsed.status,
      genre: parsed.genre,
      featuredOnly: parsed.featured === undefined ? undefined : parsed.featured === "true",
      sort: parsed.sort,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "list series");
  }
}
