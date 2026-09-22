import { beforeEach, describe, expect, test } from "bun:test";

import { readSecurityConfig } from "./config";
import {
  createSecurity,
  isPrivateNetworkOrigin,
  securityHeaders,
} from "./index";

const TEST_SECRET = "test-better-auth-secret-1234567890";

// A GET /api/auth/get-session request carrying an Origin, used by the
// private-network origin tests below.
function authGetSessionRequest(origin: string): Request {
  return new Request("http://localhost:3001/api/auth/get-session", {
    headers: { origin },
  });
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    allowPrivateNetworkOrigins: false,
    allowedOrigins: ["http://localhost:3000"],
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

  test("allows a request with an allowed browser origin", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { origin: "http://localhost:3000" },
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("rejects a request with a disallowed origin", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { origin: "https://evil.example.com" },
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "origin-not-allowed",
    });
  });

  test("rejects a request with no origin and no internal secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "internal-secret-required",
    });
  });

  test("allows an OAuth callback GET without origin or secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://localhost:3001/api/auth/callback/google?code=abc&state=xyz",
      { method: "GET" }
    );
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("allows a Reddit OAuth callback GET without origin or secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://localhost:3001/api/auth/callback/reddit?code=abc&state=xyz",
      { method: "GET" }
    );
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("still requires origin or secret for OAuth callback POSTs", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/callback/google", {
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "internal-secret-required",
    });
  });

  test("allows the Better Auth error redirect GET without origin or secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://localhost:3001/api/auth/error?error=state_mismatch",
      { method: "GET" }
    );
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("still requires origin or secret for error path POSTs", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/error", {
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "internal-secret-required",
    });
  });

  test("allows a request with the internal secret and no origin", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { "x-internal-secret": TEST_SECRET },
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("requires the internal secret on signup tRPC procedures even with an allowed origin", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://localhost:3001/api/trpc/pendingSignupStart",
      {
        headers: { origin: "http://localhost:3000" },
        method: "POST",
      }
    );
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
    expect(await decision.response?.json()).toEqual({
      error: "internal-secret-required",
    });
  });

  test("allows signup tRPC procedures with the internal secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request(
      "http://localhost:3001/api/trpc/pendingSignupVerify",
      {
        headers: {
          origin: "http://localhost:3000",
          "x-internal-secret": TEST_SECRET,
        },
        method: "POST",
      }
    );
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("rejects a request with a wrong internal secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { "x-internal-secret": "wrong-secret" },
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
  });

  test("rejects non-GET/POST methods", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { "x-internal-secret": TEST_SECRET },
      method: "DELETE",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(405);
  });

  test("rejects unknown paths", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/admin/delete", {
      headers: { "x-internal-secret": TEST_SECRET },
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(404);
  });

  test("allows the health endpoint without a secret", async () => {
    const security = createSecurity(baseConfig());
    const req = new Request("http://localhost:3001/api/health", {
      method: "GET",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  test("rejects oversized bodies", async () => {
    const security = createSecurity(baseConfig({ maxBodyBytes: 100 }));
    const req = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: {
        "content-length": "500",
        "x-internal-secret": TEST_SECRET,
      },
      method: "POST",
    });
    const decision = await security.check(req, "1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(413);
  });

  test("rate limits anonymous requests per IP", async () => {
    const security = createSecurity(
      baseConfig({ anonRateLimitMax: 3, anonRateLimitWindowMs: 60_000 })
    );
    const makeReq = () =>
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "GET",
      });

    for (let i = 0; i < 3; i += 1) {
      // Sequential hits are the point: each request consumes budget.
      // eslint-disable-next-line no-await-in-loop
      const anonymousHit = await security.check(makeReq(), "9.9.9.9");
      expect(anonymousHit.allowed).toBe(true);
    }
    const anonymousBlocked = await security.check(makeReq(), "9.9.9.9");
    expect(anonymousBlocked.allowed).toBe(false);
    expect(anonymousBlocked.response?.status).toBe(429);
    expect(anonymousBlocked.response?.headers.get("retry-after")).toBeTruthy();
  });

  test("authenticated requests get a generous limit", async () => {
    const security = createSecurity(
      baseConfig({
        anonRateLimitMax: 3,
        authRateLimitMax: 10,
        burstRateLimitMax: 100,
      })
    );
    const makeReq = (withSession: boolean) =>
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: {
          "x-internal-secret": TEST_SECRET,
          ...(withSession ? { cookie: "better-auth.session_token=abc" } : {}),
        },
        method: "GET",
      });

    // Anonymous: trips after 3.
    for (let i = 0; i < 3; i += 1) {
      // Sequential hits are the point: each request consumes budget.
      // eslint-disable-next-line no-await-in-loop
      const anonymousHit = await security.check(makeReq(false), "1.1.1.1");
      expect(anonymousHit.allowed).toBe(true);
    }
    const anonymousBlocked = await security.check(makeReq(false), "1.1.1.1");
    expect(anonymousBlocked.allowed).toBe(false);

    // Authenticated (session cookie): still allowed at 10.
    for (let i = 0; i < 6; i += 1) {
      // Sequential hits are the point: each request consumes budget.
      // eslint-disable-next-line no-await-in-loop
      const authenticatedHit = await security.check(makeReq(true), "1.1.1.1");
      expect(authenticatedHit.allowed).toBe(true);
    }
  });

  test("burst limiter blocks continuous polling", async () => {
    const security = createSecurity(
      baseConfig({ burstRateLimitMax: 2, burstRateLimitWindowMs: 60_000 })
    );
    const makeReq = () =>
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "GET",
      });

    const burstHit = await security.check(makeReq(), "3.3.3.3");
    expect(burstHit.allowed).toBe(true);
    const burstHitAgain = await security.check(makeReq(), "3.3.3.3");
    expect(burstHitAgain.allowed).toBe(true);
    const burstBlocked = await security.check(makeReq(), "3.3.3.3");
    expect(burstBlocked.allowed).toBe(false);
    expect(burstBlocked.response?.status).toBe(429);
  });

  test("applies strict limits on sensitive paths", async () => {
    const security = createSecurity(baseConfig({ strictRateLimitMax: 2 }));
    const makeReq = () =>
      new Request("http://localhost:3001/api/auth/sign-in/email", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "POST",
      });

    const strictHit = await security.check(makeReq(), "5.5.5.5");
    expect(strictHit.allowed).toBe(true);
    const strictHitAgain = await security.check(makeReq(), "5.5.5.5");
    expect(strictHitAgain.allowed).toBe(true);
    const strictBlocked = await security.check(makeReq(), "5.5.5.5");
    expect(strictBlocked.allowed).toBe(false);
    expect(strictBlocked.response?.status).toBe(429);
  });

  test("different IPs are rate limited independently", async () => {
    const security = createSecurity(
      baseConfig({ anonRateLimitMax: 2, anonRateLimitWindowMs: 60_000 })
    );
    const makeReq = () =>
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: { "x-internal-secret": TEST_SECRET },
        method: "GET",
      });

    const firstIpFirstHit = await security.check(makeReq(), "1.1.1.1");
    expect(firstIpFirstHit.allowed).toBe(true);
    const firstIpSecondHit = await security.check(makeReq(), "1.1.1.1");
    expect(firstIpSecondHit.allowed).toBe(true);
    const secondIpFirstHit = await security.check(makeReq(), "2.2.2.2");
    expect(secondIpFirstHit.allowed).toBe(true);
    const firstIpBlocked = await security.check(makeReq(), "1.1.1.1");
    expect(firstIpBlocked.allowed).toBe(false);
    const secondIpSecondHit = await security.check(makeReq(), "2.2.2.2");
    expect(secondIpSecondHit.allowed).toBe(true);
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
    expect(config.allowedOrigins).toContain("http://localhost:3000");
  });

  test("allowed origins derive from APP_URL", () => {
    const config = readSecurityConfig({
      APP_URL: "https://asocialmedia.cc",
      AUTH_URL: "https://auth.asocialmedia.cc",
    });
    expect(config.allowedOrigins).toContain("https://asocialmedia.cc");
    expect(config.allowedOrigins).toContain("https://auth.asocialmedia.cc");
  });

  test("allows private-network origins in development only", () => {
    expect(
      readSecurityConfig({ NODE_ENV: "development" }).allowPrivateNetworkOrigins
    ).toBe(true);
    expect(
      readSecurityConfig({ NODE_ENV: "test" }).allowPrivateNetworkOrigins
    ).toBe(true);
    expect(
      readSecurityConfig({ NODE_ENV: "production" }).allowPrivateNetworkOrigins
    ).toBe(false);
  });
});

describe("isPrivateNetworkOrigin", () => {
  test("accepts loopback hosts", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:3000",
      "http://[::1]:3000",
    ]) {
      expect(isPrivateNetworkOrigin(origin)).toBe(true);
    }
  });

  test("accepts the Android emulator host alias", () => {
    // This is the alias an emulator uses to reach the host machine, and the
    // reason device testing broke without this change.
    expect(isPrivateNetworkOrigin("http://10.0.2.2:3000")).toBe(true);
  });

  test("accepts RFC 1918 LAN addresses", () => {
    for (const origin of [
      "http://192.168.1.5:3000",
      "http://10.1.2.3:3000",
      "http://172.16.0.9:3000",
      "http://172.31.255.1:3000",
    ]) {
      expect(isPrivateNetworkOrigin(origin)).toBe(true);
    }
  });

  test("rejects public hosts, including ones just outside the private ranges", () => {
    for (const origin of [
      "https://evil.example.com",
      "https://asocialmedia.cc",
      "http://172.15.0.1:3000",
      "http://172.32.0.1:3000",
      "http://192.169.1.1:3000",
      "http://11.0.0.1:3000",
    ]) {
      expect(isPrivateNetworkOrigin(origin)).toBe(false);
    }
  });

  test("rejects unparseable input", () => {
    expect(isPrivateNetworkOrigin("not a url")).toBe(false);
    expect(isPrivateNetworkOrigin("")).toBe(false);
  });
});

describe("private-network origins in the guard", () => {
  test("accepts the emulator alias when the dev flag is on", async () => {
    const security = createSecurity(
      baseConfig({ allowPrivateNetworkOrigins: true })
    );
    const decision = await security.check(
      authGetSessionRequest("http://10.0.2.2:3000"),
      "1.2.3.4"
    );
    expect(decision.allowed).toBe(true);
  });

  test("rejects the emulator alias in production mode", async () => {
    const security = createSecurity(
      baseConfig({ allowPrivateNetworkOrigins: false })
    );
    const decision = await security.check(
      authGetSessionRequest("http://10.0.2.2:3000"),
      "1.2.3.4"
    );
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
  });

  test("still rejects a public origin even in development mode", async () => {
    const security = createSecurity(
      baseConfig({ allowPrivateNetworkOrigins: true })
    );
    const decision = await security.check(
      authGetSessionRequest("https://evil.example.com"),
      "1.2.3.4"
    );
    expect(decision.allowed).toBe(false);
    expect(decision.response?.status).toBe(403);
  });
});
