import { describe, expect, test } from "bun:test";

import { NextRequest } from "next/server";

import { proxy } from "./proxy";

describe("proxy middleware", () => {
  test("does not redirect loopback requests even with x-forwarded-proto http", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest(
        "http://localhost:3000/avatars/default-1.png",
        {
          headers: {
            host: "localhost:3000",
            "x-forwarded-proto": "http",
          },
        }
      );
      const res = proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("does not redirect 127.0.0.1 image optimizer fetches with x-forwarded-proto http", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest(
        "http://127.0.0.1:3000/avatars/default-2.png",
        {
          headers: {
            host: "127.0.0.1:3000",
            "x-forwarded-proto": "http",
          },
        }
      );
      const res = proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("does not redirect untrusted host headers (prevents open redirect)", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest("http://evil-attacker.com/feed", {
        headers: {
          host: "evil-attacker.com",
          "x-forwarded-proto": "http",
        },
      });
      const res = proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("redirects plain HTTP forwarded requests on approved production domain", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest("http://asocialmedia.cc/feed", {
        headers: {
          host: "asocialmedia.cc",
          "x-forwarded-proto": "http",
        },
      });
      const res = proxy(req);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://asocialmedia.cc/feed");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("does not redirect HTTPS forwarded requests on production domain", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest("http://asocialmedia.cc/feed", {
        headers: {
          host: "asocialmedia.cc",
          "x-forwarded-proto": "https",
        },
      });
      const res = proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe("proxy middleware matcher config", () => {
  const matcherPattern =
    /^\/(?:(?!_next\/|api\/|avatars\/|favicon|fonts\/|socials\/|site\.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|webmanifest|json)$).*)$/;

  test("matches application page paths", () => {
    expect(matcherPattern.test("/")).toBe(true);
    expect(matcherPattern.test("/feed")).toBe(true);
    expect(matcherPattern.test("/messages")).toBe(true);
    expect(matcherPattern.test("/posts/12345")).toBe(true);
    expect(matcherPattern.test("/users/alice")).toBe(true);
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
    expect(matcherPattern.test("/api/users/profile")).toBe(false);
  });
});
