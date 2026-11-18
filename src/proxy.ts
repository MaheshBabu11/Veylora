import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/server/auth";

const publicPaths = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/session",
  "/api/auth/logout",
  "/api/health",
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.has(pathname)) return NextResponse.next();

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      return NextResponse.redirect(loginUrl);
    }

    const headers = new Headers(request.headers);
    headers.set("x-veylora-user-id", user.id);
    headers.set("x-veylora-username", user.username);
    return NextResponse.next({ request: { headers } });
  } catch (error) {
    console.error("[auth] session validation failed", error);
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
