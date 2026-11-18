import { getAuthenticatedUser } from "@/server/auth";
import { apiError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return Response.json(await getAuthenticatedUser(request), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "get session");
  }
}
