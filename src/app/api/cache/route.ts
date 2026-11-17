import { clearPageCache } from "@/server/filesystem";
import { apiError, assertSameOrigin } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const removed = await clearPageCache();
    return Response.json({ removed });
  } catch (error) {
    return apiError(error, "clear page cache");
  }
}
