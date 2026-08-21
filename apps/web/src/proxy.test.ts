import { describe, expect, mock, test } from "bun:test";

import { NextRequest } from "next/server";

// The proxy's API guard calls consumeRateLimit (@asm/db -> ioredis). Unit
// tests here must not touch Redis: fail-open is the contract under test.
mock.module("@asm/db", () => ({
  consumeRateLimit: mock(() => ({
    allowed: true,
    remaining: 99,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  })),
}));

const { proxy } = await import("./proxy");

function makeRequest(
  url: string,
  headers: Record<string, string>
): NextRequest {
  return new NextRequest(url, { headers });
}

describe("proxy middleware", () => {
  test("does not redirect loopback requests even with x-forwarded-proto http", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = makeRequest("http://localhost:3000/avatars/default-1.png", {
        host: "localhost:3000",
        "x-forwarded-proto": "http",
      });
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("does not redirect 127.0.0.1 image optimizer fetches with x-forwarded-proto http", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = makeRequest("http://127.0.0.1:3000/avatars/default-2.png", {
        host: "127.0.0.1:3000",
        "x-forwarded-proto": "http",
      });
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("does not redirect untrusted host headers (prevents open redirect)", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = makeRequest("http://evil-attacker.com/feed", {
        host: "evil-attacker.com",
        "x-forwarded-proto": "http",
      });
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("redirects plain HTTP forwarded requests on approved production domain", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = makeRequest("http://asocialmedia.cc/feed", {
        host: "asocialmedia.cc",
        "x-forwarded-proto": "http",
      });
      const res = await proxy(req);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://asocialmedia.cc/feed");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("does not redirect HTTPS forwarded requests on production domain", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = makeRequest("http://asocialmedia.cc/feed", {
        host: "asocialmedia.cc",
        "x-forwarded-proto": "https",
      });
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("applies hardening security headers to every response", async () => {
    const req = makeRequest("http://localhost:3000/feed", {
      host: "localhost:3000",
    });
    const res = await proxy(req);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors"
    );
    // HSTS only ships in production.
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  test("adds HSTS in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = makeRequest("http://localhost:3000/feed", {
        host: "localhost:3000",
      });
      const res = await proxy(req);
      expect(res.headers.get("strict-transport-security")).toContain(
        "max-age="
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("rejects direct-to-origin traffic when Cloudflare enforcement is on", async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalFlag = process.env.ENFORCE_CLOUDFLARE;
    try {
      process.env.NODE_ENV = "production";
      process.env.ENFORCE_CLOUDFLARE = "1";
      // Re-import with the flag set: the flag is read at module load.
      const { proxy: flaggedProxy } = await import("./proxy?cf-enforced");
      const noCf = makeRequest("http://localhost:3000/feed", {
        host: "asocialmedia.cc",
      });
      const rejected = await flaggedProxy(noCf);
      expect(rejected.status).toBe(403);

      const withCf = makeRequest("http://localhost:3000/feed", {
        "cf-connecting-ip": "203.0.113.7",
        host: "asocialmedia.cc",
      });
      const allowed = await flaggedProxy(withCf);
      expect(allowed.status).toBe(200);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalFlag === undefined) {
        delete process.env.ENFORCE_CLOUDFLARE;
      } else {
        process.env.ENFORCE_CLOUDFLARE = originalFlag;
      }
    }
  });
});

describe("proxy middleware matcher config", () => {
  // Mirrors the matcher in proxy.ts. /api/ is deliberately NOT excluded so
  // route handlers get the guard and security headers too.
  const matcherPattern =
    /^\/(?:(?!_next\/|favicon|fonts\/|avatars\/|socials\/|site\.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|webmanifest|json)$).*)$/;

  test("matches application page paths", () => {
    expect(matcherPattern.test("/")).toBe(true);
    expect(matcherPattern.test("/feed")).toBe(true);
    expect(matcherPattern.test("/messages")).toBe(true);
    expect(matcherPattern.test("/posts/12345")).toBe(true);
    expect(matcherPattern.test("/users/alice")).toBe(true);
  });

  test("matches api routes so they are guarded and header-stamped", () => {
    expect(matcherPattern.test("/api/health")).toBe(true);
    expect(matcherPattern.test("/api/posts/for-you")).toBe(true);
    expect(matcherPattern.test("/api/media/some-id")).toBe(true);
  });

  test("excludes static assets and internal paths", () => {
    expect(matcherPattern.test("/avatars/default-1.png")).toBe(false);
    expect(matcherPattern.test("/avatars/default-2.png")).toBe(false);
    expect(matcherPattern.test("/favicon.ico")).toBe(false);
    expect(matcherPattern.test("/fonts/inter.woff2")).toBe(false);
    expect(matcherPattern.test("/socials/x.svg")).toBe(false);
    expect(matcherPattern.test("/site.webmanifest")).toBe(false);
    expect(matcherPattern.test("/manifest.json")).toBe(false);
    expect(matcherPattern.test("/_next/static/chunks/main.js")).toBe(false);
  });
});
