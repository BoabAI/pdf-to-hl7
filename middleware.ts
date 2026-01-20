import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Check if user is authenticated via cookie
  const isAuthenticated = request.cookies.get("app_authenticated")?.value === "true";

  // Allow access to login page and auth API without authentication
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/auth"
  ) {
    // If already authenticated and trying to access login, redirect to home
    if (isAuthenticated && request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
