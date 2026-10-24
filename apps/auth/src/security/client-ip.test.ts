import { describe, expect, test } from "bun:test";

import { getClientIpFromHeaders } from "./client-ip";

describe("getClientIpFromHeaders", () => {
  test("production rejects forwarding fallback identities and invalid ingress addresses", () => {
    const cases: HeadersInit[] = [
      { "x-forwarded-for": "203.0.113.1, 198.51.100.2" },
      { "x-real-ip": "198.51.100.3" },
      { "cf-connecting-ip": "chosen-bucket", "x-real-ip": "198.51.100.4" },
      { "cf-connecting-ip": "203.0.113.1, 203.0.113.2" },
    ];
    for (const headers of cases) {
      expect(getClientIpFromHeaders(new Headers(headers), true)).toBe(
        "unknown"
      );
    }
    expect(
      getClientIpFromHeaders(
        new Headers({ "cf-connecting-ip": "2001:db8::1" }),
        true
      )
    ).toBe("2001:db8::1");
  });
  test("prefers cf-connecting-ip over any forwarding header", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      "x-real-ip": "9.9.9.9",
    });
    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  test("takes the LAST x-forwarded-for entry, ignoring client-controlled leading entries", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.200, 198.51.100.7",
    });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  test("a single forwarded value is used as-is", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.7",
    });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  test("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.8" });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.8");
  });

  test("returns unknown when no trusted address is present", () => {
    expect(getClientIpFromHeaders(new Headers())).toBe("unknown");
  });

  test("tolerates undefined headers", () => {
    const undefinedHeaders: Headers | undefined = undefined;
    expect(getClientIpFromHeaders(undefinedHeaders)).toBe("unknown");
  });

  test("does not trust a spoofed leading entry when a real one is appended", () => {
    const headers = new Headers({
      "x-forwarded-for": "attacker.example, 198.51.100.10",
    });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.10");
  });
});
