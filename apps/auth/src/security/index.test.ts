import { beforeEach, describe, expect, test } from "bun:test";

import { readSecurityConfig } from "./config";
import { createSecurity, securityHeaders } from "./index";

const TEST_SECRET = "test-better-auth-secret-1234567890";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    allowedOrigins: ["https://social.localhost"],
    anonRateLimitMax: 5,
    anonRateLimitWindowMs: 60_000,
    authRateLimitMax: 10,
    authRateLimitWindowMs: 60_000,
    burstRateLimitMax: 4,
    burstRateLimitWindowMs: 60_000,
    internalSecret: TEST_SECRET,
    maxBodyBytes: 1024,
    maxConcurrentRequests: 4,
    requestTimeoutMs: 15_000,
    strictPaths: [/^\/api\/auth\/sign-in/],
    strictRateLimitMax: 2,
    strictRateLimitWindowMs: 60_000,
    ...overrides,
  };
}

describe("createSecurity", () => {
  beforeEach(() => {
    // Reset module-level env between tests
    delete process.env.AUTH_INTERNAL_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
  });

  test("allows a request with an allowed browser origin", () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      headers: { origin: "https://social.localhost" },
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("rejects a request with a disallowed origin", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      headers: { origin: "https://evil.example.com" },
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "origin-not-allowed",
    });
  });

  test("rejects a request with no origin and no internal secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "internal-secret-required",
    });
  });

  test("allows an OAuth callback GET without origin or secret", () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://auth.localhost/api/auth/callback/google?code=abc&state=xyz",
      { method: "GET" }
    );
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("allows a Reddit OAuth callback GET without origin or secret", () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://auth.localhost/api/auth/callback/reddit?code=abc&state=xyz",
      { method: "GET" }
    );
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("still requires origin or secret for OAuth callback POSTs", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/callback/google", {
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "internal-secret-required",
    });
  });

  test("allows a request with the internal secret and no origin", () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      headers: { "x-internal-secret": TEST_SECRET },
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("rejects a request with a wrong internal secret", () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      headers: { "x-internal-secret": "wrong-secret" },
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
  });

  test("rejects non-GET/POST methods", () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      headers: { "x-internal-secret": TEST_SECRET },
      method: "DELETE",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(405);
  });

  test("rejects unknown paths", () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/admin/delete", {
      headers: { "x-internal-secret": TEST_SECRET },
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(404);
  });

  test("allows the health endpoint without a secret", () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://auth.localhost/api/health", {
      method: "GET",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("rejects oversized bodies", () => {
    const security = createSecurity(baseConfig({ maxBodyBytes: 100 }));
    const req = new Request("http://auth.localhost/api/auth/sign-in/email", {
      headers: {
        "content-length": "500",
        "x-internal-secret": TEST_SECRET,
      },
      method: "POST",
    });
    const decision = security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(413);
  });

  test("rate limits anonymous requests per IP", () => {
    const security = createSecurity(
      baseConfig({ anonRateLimitMax: 3, anonRateLimitWindowMs: 60_000 })
    );
    const makeReq = () =>
      new Request("http://auth.localhost/api/auth/get-session", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "GET",
      });

    for (let i = 0; i < 3; i += 1) {
      expect(security.check(makeReq(), "9.9.9.9").allowed).toBe(true);
    }
    const fourth = security.check(makeReq(), "9.9.9.9");
    expect(fourth.allowed).toBe(false);
    expect(fourth.response?.status).toBe(429);
    expect(fourth.response?.headers.get("retry-after")).toBeTruthy();
  });

  test("authenticated requests get a generous limit", () => {
    const security = createSecurity(
      baseConfig({
        anonRateLimitMax: 3,
        authRateLimitMax: 10,
        burstRateLimitMax: 100,
      })
    );
    const makeReq = (withSession: boolean) =>
      new Request("http://auth.localhost/api/auth/get-session", {
        headers: {
          "x-internal-secret": TEST_SECRET,
          ...(withSession ? { cookie: "better-auth.session_token=abc" } : {}),
        },
        method: "GET",
      });

    // Anonymous: trips after 3.
    for (let i = 0; i < 3; i += 1) {
      expect(security.check(makeReq(false), "1.1.1.1").allowed).toBe(true);
    }
    expect(security.check(makeReq(false), "1.1.1.1").allowed).toBe(false);

    // Authenticated (session cookie): still allowed at 10.
    for (let i = 0; i < 6; i += 1) {
      expect(security.check(makeReq(true), "1.1.1.1").allowed).toBe(true);
    }
  });

  test("burst limiter blocks continuous polling", () => {
    const security = createSecurity(
      baseConfig({ burstRateLimitMax: 2, burstRateLimitWindowMs: 60_000 })
    );
    const makeReq = () =>
      new Request("http://auth.localhost/api/auth/get-session", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "GET",
      });

    expect(security.check(makeReq(), "3.3.3.3").allowed).toBe(true);
    expect(security.check(makeReq(), "3.3.3.3").allowed).toBe(true);
    const third = security.check(makeReq(), "3.3.3.3");
    expect(third.allowed).toBe(false);
    expect(third.response?.status).toBe(429);
  });

  test("applies strict limits on sensitive paths", () => {
    const security = createSecurity(baseConfig({ strictRateLimitMax: 2 }));
    const makeReq = () =>
      new Request("http://auth.localhost/api/auth/sign-in/email", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "POST",
      });

    expect(security.check(makeReq(), "5.5.5.5").allowed).toBe(true);
    expect(security.check(makeReq(), "5.5.5.5").allowed).toBe(true);
    const third = security.check(makeReq(), "5.5.5.5");
    expect(third.allowed).toBe(false);
    expect(third.response?.status).toBe(429);
  });

  test("different IPs are rate limited independently", () => {
    const security = createSecurity(
      baseConfig({ anonRateLimitMax: 2, anonRateLimitWindowMs: 60_000 })
    );
    const makeReq = () =>
      new Request("http://auth.localhost/api/auth/get-session", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "GET",
      });

    expect(security.check(makeReq(), "1.1.1.1").allowed).toBe(true);
    expect(security.check(makeReq(), "1.1.1.1").allowed).toBe(true);
    expect(security.check(makeReq(), "2.2.2.2").allowed).toBe(true);
    expect(security.check(makeReq(), "1.1.1.1").allowed).toBe(false);
    expect(security.check(makeReq(), "2.2.2.2").allowed).toBe(true);
  });
});

describe("security headers", () => {
  test("includes hardening headers", () => {
    const headers = securityHeaders();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("readSecurityConfig", () => {
  test("falls back to BETTER_AUTH_SECRET for the internal secret", () => {
    const config = readSecurityConfig({
      APP_URL: "https://asocialmedia.cc",
      AUTH_URL: "https://auth.asocialmedia.cc",
      BETTER_AUTH_SECRET: TEST_SECRET,
    });
    expect(config.internalSecret).toBe(TEST_SECRET);
    expect(config.allowedOrigins).toContain("https://asocialmedia.cc");
    expect(config.maxBodyBytes).toBe(100 * 1024);
  });

  test("AUTH_INTERNAL_SECRET overrides BETTER_AUTH_SECRET", () => {
    const config = readSecurityConfig({
      AUTH_INTERNAL_SECRET: "override",
      BETTER_AUTH_SECRET: TEST_SECRET,
    });
    expect(config.internalSecret).toBe("override");
  });

  test("applies optimal defaults when env vars are missing", () => {
    const config = readSecurityConfig({});
    expect(config.maxBodyBytes).toBe(100 * 1024);
    expect(config.maxConcurrentRequests).toBe(512);
    expect(config.requestTimeoutMs).toBe(15_000);
    expect(config.authRateLimitMax).toBe(600);
    expect(config.anonRateLimitMax).toBe(120);
    expect(config.strictRateLimitMax).toBe(30);
    expect(config.burstRateLimitMax).toBe(30);
    expect(config.allowedOrigins).toContain("https://social.localhost");
  });

  test("allowed origins derive from APP_URL", () => {
    const config = readSecurityConfig({
      APP_URL: "https://asocialmedia.cc",
      AUTH_URL: "https://auth.asocialmedia.cc",
    });
    expect(config.allowedOrigins).toContain("https://asocialmedia.cc");
    expect(config.allowedOrigins).toContain("https://auth.asocialmedia.cc");
  });
});
