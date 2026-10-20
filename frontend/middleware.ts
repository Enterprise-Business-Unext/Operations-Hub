import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection.
 *
 * The backend sets `ops_session` as an HttpOnly cookie alongside the auth
 * cookies. Middleware uses its presence to reject unauthenticated requests
 * before the page renders; the client validates the actual session with `/me`.
 *
 * This is a navigation-level guard only. It contains no credentials, and it is
 * not a substitute for authorization, which the API must enforce on every
 * request.
 */
const SESSION_COOKIE = "ops_session";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (isPublic) {
    // Let the client validate HttpOnly session cookies. A stale presence
    // cookie must not bounce /login back to a protected route indefinitely.
    return NextResponse.next();
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|xlsx|csv)$).*)"],
};
