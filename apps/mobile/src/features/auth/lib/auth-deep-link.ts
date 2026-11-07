// Maps the web auth links that arrive by email (verify-email and the reset
// confirm page) onto the native auth routes. Returns null for anything else
// so the caller can fall through to the general link table. OAuth failures
// also arrive as auth links: /login/error carries the provider's `?error=`
// (and `?email=`) to the login-error screen, and /two-factor falls back to
// the login screen that hosts the inline 2FA challenge.
const HOSTS = new Set(["asocialmedia.cc", "www.asocialmedia.cc"]);
const FORWARDED_PARAMS = ["token", "error", "verified", "email"];

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
  if (pathname === "/login/error") {
    return `/login-error${forwardQuery(url)}`;
  }
  // Web's standalone 2FA page has no native counterpart; the login screen
  // hosts the same challenge inline (email, authenticator and recovery code).
  if (pathname === "/two-factor") {
    return "/login";
  }
  return null;
}
