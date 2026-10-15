import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection.
 *
 * The app stores its credentials in `localStorage`, which edge middleware cannot
 * read. `AuthContext` therefore mirrors a non-sensitive presence flag into the
 * `ops_session` cookie, and this middleware uses it to reject unauthenticated
 * requests *before* the page is rendered, instead of bouncing the user after
 * hydration.
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
    // Already signed in and heading for the login screen: send them home.
    if (hasSession) {
      return NextResponse.redirect(new URL("/", request.url));
    }
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
