import { describe, expect, test } from "bun:test";

import {
  createInstallFetch,
  isSameOrigin,
  parseRegisterResponse,
  resolveRequestUrl,
  withInstallHeader,
} from "./install-token";

const ORIGIN = "https://asocialmedia.cc";

interface Call {
  init?: RequestInit;
  url: string;
}

function firstCall(calls: Call[]): Call {
  const [call] = calls;
  if (!call) {
    throw new Error("expected the wrapped fetch to have been called");
  }
  return call;
}

function headerOf(call: Call): string | null {
  return new Headers(call.init?.headers).get("x-asm-install");
}

function harness(token: string | null) {
  const calls: Call[] = [];
  const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: resolveRequestUrl(input) ?? "" });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  const wrapped = createInstallFetch({
    baseFetch,
    getToken: () => token,
    origin: ORIGIN,
  });
  return { calls, wrapped };
}

describe("resolveRequestUrl", () => {
  test("handles strings and URL objects", () => {
    expect(resolveRequestUrl("https://x/y")).toBe("https://x/y");
    expect(resolveRequestUrl(new URL("https://x/y"))).toBe("https://x/y");
  });
});

describe("isSameOrigin", () => {
  test("accepts the origin and its subpaths", () => {
    expect(isSameOrigin(`${ORIGIN}/api/auth`, ORIGIN)).toBe(true);
    expect(isSameOrigin(ORIGIN, ORIGIN)).toBe(true);
  });

  test("accepts relative URLs as same-origin", () => {
    expect(isSameOrigin("/api/auth", ORIGIN)).toBe(true);
  });

  test("rejects other hosts", () => {
    expect(isSameOrigin("https://api.github.com/repos/x", ORIGIN)).toBe(false);
    expect(isSameOrigin("https://evil.example/api/auth", ORIGIN)).toBe(false);
  });

  test("rejects null/empty", () => {
    expect(isSameOrigin(null, ORIGIN)).toBe(false);
    expect(isSameOrigin(`${ORIGIN}/x`, "")).toBe(false);
  });
});

describe("createInstallFetch", () => {
  test("attaches the token to same-origin requests", async () => {
    const { calls, wrapped } = harness("token-abc");
    await wrapped(`${ORIGIN}/api/auth/get-session`);
    expect(calls).toHaveLength(1);
    expect(headerOf(firstCall(calls))).toBe("token-abc");
  });

  test("does not attach the token to other hosts", async () => {
    const { calls, wrapped } = harness("token-abc");
    await wrapped("https://api.github.com/repos/x");
    expect(headerOf(firstCall(calls))).toBeNull();
  });

  test("passes through unchanged when no token is stored", async () => {
    const { calls, wrapped } = harness(null);
    await wrapped(`${ORIGIN}/api/auth/get-session`);
    expect(headerOf(firstCall(calls))).toBeNull();
  });

  test("preserves caller headers and does not clobber an explicit token", async () => {
    const { calls, wrapped } = harness("from-store");
    await wrapped(`${ORIGIN}/api/x`, {
      headers: {
        "Content-Type": "application/json",
        "x-asm-install": "explicit",
      },
    });
    const headers = new Headers(firstCall(calls).init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-asm-install")).toBe("explicit");
  });

  test("preserves method and body", async () => {
    const { calls, wrapped } = harness("t");
    await wrapped(`${ORIGIN}/api/x`, { body: "{}", method: "POST" });
    const call = firstCall(calls);
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe("{}");
  });
});

describe("parseRegisterResponse", () => {
  test("accepts a well-formed payload", () => {
    expect(
      parseRegisterResponse({ installId: "abc", token: "v1.abc.1.sig" })
    ).toEqual({ installId: "abc", token: "v1.abc.1.sig" });
  });

  test("rejects malformed payloads", () => {
    for (const bad of [
      null,
      "nope",
      {},
      { installId: "a" },
      { token: "b" },
      { installId: "", token: "b" },
      { installId: "a", token: "" },
      { installId: 1, token: "b" },
    ]) {
      expect(parseRegisterResponse(bad)).toBeNull();
    }
  });
});

describe("withInstallHeader", () => {
  test("adds the header only when a token exists", () => {
    expect(withInstallHeader({ a: "1" }, "tok")).toEqual({
      a: "1",
      "x-asm-install": "tok",
    });
    expect(withInstallHeader({ a: "1" }, null)).toEqual({ a: "1" });
  });
});
