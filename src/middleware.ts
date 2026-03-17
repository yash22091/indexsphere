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

// Define public routes that don't require authentication
const publicRoutes = ["/auth"];

// Define protected routes that require authentication
const protectedRoutes = ["/connect", "/overview", "/dashboard", "/nodes", "/indices", "/cluster-analysis", "/settings", "/auth-config", "/user-management"];

// Define admin-only routes
const adminOnlyRoutes = ["/user-management", "/auth-config"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if the user has an authentication token
  const authToken = request.cookies.get("auth-token")?.value;
  const isAuthenticated = !!authToken;

  // Gate: if the user's token carries mustChangePassword, only /auth/change-password
  // and /api/auth/* are allowed. Everything else redirects to the change-password page.
  if (isAuthenticated) {
    const payload = decodeJwtPayload(authToken!);
    if (payload?.mustChangePassword) {
      const allowed =
        pathname.startsWith('/auth/change-password') ||
        pathname.startsWith('/api/auth/');
      if (!allowed) {
        return NextResponse.redirect(new URL('/auth/change-password', request.url));
      }
    }
  }

  // Allow access to public routes
  if (publicRoutes.includes(pathname)) {
    // If user is already authenticated and trying to access auth page, redirect to connect
    if (isAuthenticated && pathname === "/auth") {
      return NextResponse.redirect(new URL("/connect", request.url));
    }
    return NextResponse.next();
  }

  // Check if the route is protected
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));

  if (isProtectedRoute && !isAuthenticated) {
    // Redirect to authentication page
    const authUrl = new URL("/auth", request.url);
    authUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(authUrl);
  }

  // Check admin-only routes
  if (isAuthenticated && adminOnlyRoutes.some(route => pathname.startsWith(route))) {
    const payload = decodeJwtPayload(authToken!);
    const hasAdminAccess = Array.isArray(payload?.permissions) &&
      (payload.permissions as string[]).includes('admin');
    if (!hasAdminAccess) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }
  }

  // For the root path, redirect based on authentication status
  if (pathname === "/") {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/overview", request.url));
    } else {
      return NextResponse.redirect(new URL("/auth", request.url));
    }
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
