import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

const ALLOWED_PRODUCTION_HOSTS = new Set([
  "asocialmedia.cc",
  "www.asocialmedia.cc",
]);

export function getHostname(host: string): string {
  if (host.startsWith("[")) {
    const endBracket = host.indexOf("]");
    return endBracket === -1 ? host : host.slice(0, endBracket + 1);
  }
  return host.split(":")[0]?.toLowerCase() ?? "";
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const hostname = getHostname(host);
  const isLoopback = LOOPBACK_HOSTNAMES.has(hostname);
  const isAllowedHost = ALLOWED_PRODUCTION_HOSTS.has(hostname);

  // Only redirect plain HTTP forwarded requests on approved production domains.
  // Never redirect internal server-to-server or loopback image optimizer fetches.
  if (
    process.env.NODE_ENV === "production" &&
    !isLoopback &&
    isAllowedHost &&
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
