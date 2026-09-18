import { NextResponse } from "next/server";

// Error responses for the media serving routes. Failures must never be
// cached anywhere: a stored 404/401 would keep failing after the underlying
// state heals (bytes published, membership granted, block lifted), turning a
// transient miss into a permanently broken image with no working retry.
// Plain error responses carry no validators, but shared caches and heuristic
// freshness can still retain them — hence the explicit no-store.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export function mediaError(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    headers: { ...NO_STORE_HEADERS },
    status,
  });
}

export function mediaJsonError(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    { headers: { ...NO_STORE_HEADERS }, status }
  );
}
