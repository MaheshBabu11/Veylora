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
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const withSecurityHeaders = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  if (publicPaths.has(pathname)) {
    return withSecurityHeaders(NextResponse.next({ request: { headers } }));
  }

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return withSecurityHeaders(NextResponse.json({ error: "Please sign in to continue." }, { status: 401 }));
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      return withSecurityHeaders(NextResponse.redirect(loginUrl));
    }

    headers.set("x-veylora-user-id", user.id);
    headers.set("x-veylora-username", user.username);
    return withSecurityHeaders(NextResponse.next({ request: { headers } }));
  } catch (error) {
    console.error("[auth] session validation failed", error);
    return withSecurityHeaders(NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 }));
  }
}

export const config = {
  // The upload route authenticates itself so Next.js can stream large request bodies without proxy buffering.
  matcher: ["/((?!api/library/upload$|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
