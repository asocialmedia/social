// Use the configured public origin behind TLS-terminating proxies, never caller-supplied forwarded headers.
export function isTrustedMutationOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const expected =
      process.env.NODE_ENV === "production"
        ? (process.env.NEXT_PUBLIC_URL ?? "https://asocialmedia.cc")
        : request.url;
    return origin === new URL(expected).origin;
  } catch {
    return false;
  }
}
