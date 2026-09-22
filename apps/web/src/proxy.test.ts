import { describe, expect, mock, test } from "bun:test";

import * as actualDb from "@asm/db";
import { NextRequest } from "next/server";

import { issueInstallToken } from "./lib/mobile/install-token";

// The proxy's API guard calls consumeRateLimit (@asm/db -> ioredis). Unit
// tests here must not touch Redis: fail-open is the contract under test.
mock.module("@asm/db", () => ({
  ...actualDb,
  consumeRateLimit: mock(() => ({
    allowed: true,
    remaining: 99,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  })),
  getClientIpFromHeaders: mock(
    (headers: { get: (name: string) => string | null }) =>
      headers.get("cf-connecting-ip") ?? "unknown"
  ),
}));

const { proxy } = await import("./proxy");

function makeRequest(
  url: string,
  headers: Record<string, string>,
  method = "GET"
): NextRequest {
  return new NextRequest(url, { headers, method });
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

  test("allows public media read endpoints without same-origin evidence and sets x-robots-tag noindex", async () => {
    const avatarReq = makeRequest(
      "http://localhost:3000/api/users/avatar/user123/image",
      {
        host: "localhost:3000",
      }
    );
    const avatarRes = await proxy(avatarReq);
    expect(avatarRes.status).toBe(200);
    expect(avatarRes.headers.get("x-robots-tag")).toBe("noindex");

    const mediaReq = makeRequest("http://localhost:3000/api/media/med123", {
      host: "localhost:3000",
    });
    const mediaRes = await proxy(mediaReq);
    expect(mediaRes.status).toBe(200);
    expect(mediaRes.headers.get("x-robots-tag")).toBe("noindex");
  });
});

describe("api cross-site guard", () => {
  // The guard must reject genuine browser CSRF while letting through callers
  // that send no origin metadata at all - the native app's fetch, CLI tools,
  // server-to-server. Those used to be rejected, which 403'd the mobile client.
  const API = "https://asocialmedia.cc/api/auth/get-session";

  test("allows a native client that sends no origin metadata", async () => {
    const res = await proxy(
      makeRequest(API, { host: "asocialmedia.cc", "user-agent": "okhttp/4.9" })
    );
    expect(res.status).toBe(200);
  });

  test("allows a same-origin browser request", async () => {
    const res = await proxy(
      makeRequest(API, {
        host: "asocialmedia.cc",
        origin: "https://asocialmedia.cc",
      })
    );
    expect(res.status).toBe(200);
  });

  test("rejects a cross-site Origin", async () => {
    const res = await proxy(
      makeRequest(API, {
        host: "asocialmedia.cc",
        origin: "https://evil.example",
      })
    );
    expect(res.status).toBe(403);
  });

  test("rejects a cross-site Referer", async () => {
    const res = await proxy(
      makeRequest(API, {
        host: "asocialmedia.cc",
        referer: "https://evil.example/page",
      })
    );
    expect(res.status).toBe(403);
  });

  test("rejects Sec-Fetch-Site: cross-site", async () => {
    const res = await proxy(
      makeRequest(API, {
        host: "asocialmedia.cc",
        "sec-fetch-site": "cross-site",
      })
    );
    expect(res.status).toBe(403);
  });
});

describe("install-token gate", () => {
  const SECRET = "unit-test-install-secret";
  const CHANGE_API = "https://asocialmedia.cc/api/some/mutation";

  async function withSecret<T>(run: () => Promise<T>): Promise<T> {
    const original = process.env.MOBILE_INSTALL_SECRET;
    process.env.MOBILE_INSTALL_SECRET = SECRET;
    try {
      return await run();
    } finally {
      if (original === undefined) {
        delete process.env.MOBILE_INSTALL_SECRET;
      } else {
        process.env.MOBILE_INSTALL_SECRET = original;
      }
    }
  }

  test("blocks a scripted mutation that presents no token", async () => {
    await withSecret(async () => {
      const res = await proxy(
        makeRequest(
          CHANGE_API,
          { host: "asocialmedia.cc", "user-agent": "curl/8" },
          "POST"
        )
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "install-token-required" });
    });
  });

  test("blocks a mutation carrying a forged token", async () => {
    await withSecret(async () => {
      const res = await proxy(
        makeRequest(
          CHANGE_API,
          {
            host: "asocialmedia.cc",
            "x-asm-install": "v1.forged.1700000000000.nope",
          },
          "POST"
        )
      );
      expect(res.status).toBe(403);
    });
  });

  test("allows a mutation carrying a valid install token", async () => {
    await withSecret(async () => {
      const issued = issueInstallToken(SECRET);
      const res = await proxy(
        makeRequest(
          CHANGE_API,
          { host: "asocialmedia.cc", "x-asm-install": issued?.token ?? "" },
          "POST"
        )
      );
      expect(res.status).toBe(200);
    });
  });

  test("leaves read-only requests open for public content", async () => {
    await withSecret(async () => {
      const res = await proxy(
        makeRequest("https://asocialmedia.cc/api/communities", {
          host: "asocialmedia.cc",
        })
      );
      expect(res.status).toBe(200);
    });
  });

  test("leaves signing in token-free (rate limits guard it instead)", async () => {
    await withSecret(async () => {
      const paths = [
        "/api/auth/sign-in/email",
        "/api/auth/sign-in/username",
        "/api/auth/sign-in/social",
        "/api/auth/two-factor/verify-totp",
        "/api/auth/passkey/verify-authentication",
        "/api/auth/sign-out",
        "/api/reset-password",
        "/api/auth/reset-password",
      ];
      const responses = await Promise.all(
        paths.map((path) =>
          proxy(
            makeRequest(
              `https://asocialmedia.cc${path}`,
              { host: "asocialmedia.cc", "user-agent": "okhttp/4.12" },
              "POST"
            )
          )
        )
      );
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
      // Sign-up stays behind its own gates, and unrelated mutations still
      // need the token.
      const blocked = await proxy(
        makeRequest(
          "https://asocialmedia.cc/api/auth/update-user",
          { host: "asocialmedia.cc", "user-agent": "okhttp/4.12" },
          "POST"
        )
      );
      expect(blocked.status).toBe(403);
    });
  });

  test("leaves the register bootstrap open (Turnstile-gated instead)", async () => {
    await withSecret(async () => {
      const res = await proxy(
        makeRequest("https://asocialmedia.cc/api/mobile/register", {
          host: "asocialmedia.cc",
        })
      );
      expect(res.status).toBe(200);
    });
  });

  test("leaves the signup bootstrap open (Turnstile + OTP gated instead)", async () => {
    await withSecret(async () => {
      const responses = await Promise.all(
        ["/api/signup", "/api/signup/resend", "/api/verify-email"].map((path) =>
          proxy(
            makeRequest(
              `https://asocialmedia.cc${path}`,
              {
                host: "asocialmedia.cc",
              },
              "POST"
            )
          )
        )
      );
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });
  });

  test("still gates auth mutations outside the sign-in family", async () => {
    await withSecret(async () => {
      const responses = await Promise.all(
        ["/api/auth/update-user", "/api/auth/change-password"].map((path) =>
          proxy(
            makeRequest(
              `https://asocialmedia.cc${path}`,
              { host: "asocialmedia.cc" },
              "POST"
            )
          )
        )
      );
      for (const res of responses) {
        expect(res.status).toBe(403);
      }
    });
  });

  test("does not gate browser mutations with same-origin evidence", async () => {
    await withSecret(async () => {
      const res = await proxy(
        makeRequest(
          CHANGE_API,
          { host: "asocialmedia.cc", origin: "https://asocialmedia.cc" },
          "POST"
        )
      );
      expect(res.status).toBe(200);
    });
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
