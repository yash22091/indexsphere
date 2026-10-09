import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Decode a JWT payload in the Edge Runtime without crypto verification.
// Security note: signature validation still happens in every API route handler.
// Middleware only uses the payload for routing decisions.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Edge Runtime has global atob(); handle URL-safe Base64
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

// Deny by default: every page requires a session except these.
// (API routes are excluded from this middleware and authenticate in their handlers.)
const publicRoutes = ["/auth"];

// Define admin-only routes
const adminOnlyRoutes = ["/user-management", "/auth-config"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only treat the cookie as a session if it decodes and is not expired.
  // Signature/boot/user checks happen server-side in every API handler.
  const authToken = request.cookies.get("auth-token")?.value;
  const payload = authToken ? decodeJwtPayload(authToken) : null;
  const isAuthenticated = !!payload;

  // Gate: if the user's token carries mustChangePassword, only /auth/change-password
  // is reachable. Everything else redirects to the change-password page.
  if (payload?.mustChangePassword && !pathname.startsWith('/auth/change-password')) {
    return NextResponse.redirect(new URL('/auth/change-password', request.url));
  }

  if (publicRoutes.includes(pathname)) {
    // If user is already authenticated and trying to access auth page, redirect to connect
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/connect", request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const authUrl = new URL("/auth", request.url);
    if (pathname !== "/") authUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(authUrl);
  }

  // Check admin-only routes
  if (adminOnlyRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    const hasAdminAccess = Array.isArray(payload?.permissions) &&
      (payload.permissions as string[]).includes('admin');
    if (!hasAdminAccess) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
