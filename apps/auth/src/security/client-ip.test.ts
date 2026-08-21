import { describe, expect, test } from "bun:test";

import { getClientIpFromHeaders } from "./client-ip";

describe("getClientIpFromHeaders", () => {
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
