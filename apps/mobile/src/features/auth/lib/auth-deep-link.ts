// Maps the web auth links that arrive by email (verify-email and the reset
// confirm page) onto the native auth routes. Returns null for anything else
// so the caller can fall through to the general link table.
const HOSTS = new Set(["asocialmedia.cc", "www.asocialmedia.cc"]);
const FORWARDED_PARAMS = ["token", "error", "verified"];

function toPathAndQuery(value: string): URL | null {
  try {
    if (value.startsWith("/") && !value.startsWith("//")) {
      return new URL(value, "https://asocialmedia.cc");
    }
    const url = new URL(value);
    if (url.protocol === "asocialmedia:") {
      return new URL(
        `/${url.host}${url.pathname}${url.search}`,
        "https://asocialmedia.cc"
      );
    }
    if (url.protocol === "https:" && HOSTS.has(url.hostname)) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function forwardQuery(url: URL): string {
  const next = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) {
      next.set(key, value);
    }
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

export function authDeepLinkPath(value: string): string | null {
  if (/[\\\r\n]/.test(value)) {
    return null;
  }
  const url = toPathAndQuery(value);
  if (!url) {
    return null;
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/verify-email") {
    return `/verify-email${forwardQuery(url)}`;
  }
  if (pathname === "/reset-password/confirm" || pathname === "/confirm-reset") {
    return `/confirm-reset${forwardQuery(url)}`;
  }
  if (pathname === "/reset-password") {
    return "/reset-password";
  }
  if (pathname === "/signup") {
    return "/signup";
  }
  return null;
}
