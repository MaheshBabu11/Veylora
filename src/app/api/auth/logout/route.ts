import { expiredSessionCookie } from "@/server/auth";
import { apiError, assertSameOrigin } from "@/server/http";
import { revokeSession } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeSession(request);
    return Response.json(
      { signedOut: true },
      { headers: { "Set-Cookie": expiredSessionCookie(process.env.NODE_ENV === "production") } },
    );
  } catch (error) {
    return apiError(error, "sign out");
  }
}
