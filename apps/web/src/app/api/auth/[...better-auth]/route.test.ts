import { describe, expect, test } from "bun:test";

import { rewriteCookieDomain } from "./route";

const HOST = "social.asocialmedia.cc";

describe("rewriteCookieDomain", () => {
  test("preserves a shared parent domain that covers the web host", () => {
    const cookie =
      "better-auth.session_token=abc; Path=/; Domain=.asocialmedia.cc";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(cookie);
  });

  test("preserves an exact host match", () => {
    const cookie = "foo=bar; Path=/; Domain=social.asocialmedia.cc";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(cookie);
  });

  test("rewrites a sibling subdomain to the web host", () => {
    const cookie = "foo=bar; Path=/; Domain=auth.asocialmedia.cc";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(
      "foo=bar; Path=/; Domain=social.asocialmedia.cc"
    );
  });

  test("rewrites an unrelated domain to the web host", () => {
    const cookie = "foo=bar; Path=/; Domain=example.com";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(
      "foo=bar; Path=/; Domain=social.asocialmedia.cc"
    );
  });

  test("rewrites a lookalike suffix that is not a subdomain", () => {
    const cookie = "foo=bar; Path=/; Domain=.notasocialmedia.cc";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(
      "foo=bar; Path=/; Domain=social.asocialmedia.cc"
    );
  });

  test("preserves a parent domain regardless of case", () => {
    const cookie = "foo=bar; Path=/; Domain=.AsocialMedia.CC";
    expect(rewriteCookieDomain(cookie, "SOCIAL.ASOCIALMEDIA.CC")).toBe(
      "foo=bar; Path=/; Domain=.AsocialMedia.CC"
    );
  });

  test("rewrites a case-insensitive non-matching domain", () => {
    const cookie = "foo=bar; Path=/; Domain=.NOTASOCIALMEDIA.CC";
    expect(rewriteCookieDomain(cookie, "SOCIAL.ASOCIALMEDIA.CC")).toBe(
      "foo=bar; Path=/; Domain=SOCIAL.ASOCIALMEDIA.CC"
    );
  });

  test("rewrites an empty or missing domain to the web host", () => {
    expect(rewriteCookieDomain("foo=bar; Path=/; Domain=", HOST)).toBe(
      "foo=bar; Path=/; Domain=social.asocialmedia.cc"
    );
  });

  test("leaves cookies without a Domain attribute untouched", () => {
    const cookie = "foo=bar; Path=/; HttpOnly";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(cookie);
  });

  test("handles multiple attributes and a single Domain rewrite", () => {
    const cookie = "a=b; Path=/; HttpOnly; Secure; Domain=auth.asocialmedia.cc";
    expect(rewriteCookieDomain(cookie, HOST)).toBe(
      "a=b; Path=/; HttpOnly; Secure; Domain=social.asocialmedia.cc"
    );
  });
});
