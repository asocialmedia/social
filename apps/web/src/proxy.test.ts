import { describe, expect, test } from "bun:test";

import { NextRequest } from "next/server";

import { proxy } from "./proxy";

describe("proxy middleware", () => {
  test("does not redirect loopback requests", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest(
        "http://localhost:3000/avatars/default-1.png",
        {
          headers: {
            host: "localhost:3000",
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

  test("does not redirect 127.0.0.1 image optimizer fetches", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new NextRequest(
        "http://127.0.0.1:3000/avatars/default-2.png",
        {
          headers: {
            host: "127.0.0.1:3000",
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

  test("redirects plain HTTP forwarded requests on production domain", () => {
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
