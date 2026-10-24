import { afterEach, expect, test } from "bun:test";

import { isTrustedMutationOrigin } from "./request-origin";

const originalEnvironment = process.env.NODE_ENV;
const originalUrl = process.env.NEXT_PUBLIC_URL;
afterEach(() => {
  process.env.NODE_ENV = originalEnvironment;
  if (originalUrl === undefined) {
    delete process.env.NEXT_PUBLIC_URL;
  } else {
    process.env.NEXT_PUBLIC_URL = originalUrl;
  }
});

test("production mutations accept the public HTTPS origin behind an internal HTTP URL", () => {
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_URL = "https://asocialmedia.cc";
  const request = new Request("http://0.0.0.0:3000/api/network/preferences", {
    headers: {
      origin: "https://asocialmedia.cc",
      "sec-fetch-site": "same-origin",
    },
  });
  expect(isTrustedMutationOrigin(request)).toBe(true);
});

test("cross-site and forged forwarded origins remain rejected", () => {
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_URL = "https://asocialmedia.cc";
  for (const headers of [
    { origin: "https://evil.example", "x-forwarded-host": "evil.example" },
    { origin: "https://asocialmedia.cc", "sec-fetch-site": "cross-site" },
    { origin: "null" },
  ]) {
    expect(
      isTrustedMutationOrigin(
        new Request("http://internal:3000/api/network/preferences", { headers })
      )
    ).toBe(false);
  }
});

test("development compares against its local origin", () => {
  process.env.NODE_ENV = "development";
  expect(
    isTrustedMutationOrigin(
      new Request("http://localhost:3000/api/network/preferences", {
        headers: { origin: "http://localhost:3000" },
      })
    )
  ).toBe(true);
});
