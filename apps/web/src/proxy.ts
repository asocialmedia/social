import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isLoopback =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("0.0.0.0") ||
    host.startsWith("[::1]");

  // Only redirect plain HTTP forwarded requests on production domains.
  // Never redirect internal server-to-server or loopback image optimizer fetches.
  if (
    process.env.NODE_ENV === "production" &&
    !isLoopback &&
    request.headers.get("x-forwarded-proto") === "http"
  ) {
    return NextResponse.redirect(
      `https://${host}${request.nextUrl.pathname}${request.nextUrl.search}`,
      301
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|api/|avatars/|favicon|fonts/|socials/|site\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|webmanifest|json)$).*)",
  ],
};
