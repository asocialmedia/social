import { describe, expect, test } from "bun:test";

import { assertPasswordNotPwned, PasswordSafetyError } from "./password-breach";

const compromisedPasswordRange = (): Promise<Response> =>
  Promise.resolve(
    new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:4661234\r\n", {
      status: 200,
    })
  );

const safePasswordRange = (): Promise<Response> =>
  Promise.resolve(
    new Response("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\r\n", {
      status: 200,
    })
  );

const unavailablePasswordRange = (): Promise<Response> =>
  Promise.resolve(new Response("service unavailable", { status: 503 }));

const paddedOnlyRange = (): Promise<Response> =>
  Promise.resolve(
    new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\r\n", {
      status: 200,
    })
  );

describe("assertPasswordNotPwned", () => {
  test("rejects a password present in the returned k-anonymity range", async () => {
    await expect(
      assertPasswordNotPwned("password", compromisedPasswordRange)
    ).rejects.toMatchObject({ reason: "compromised" });
  });

  test("allows a password missing from the returned range", async () => {
    await expect(
      assertPasswordNotPwned("a-unique-password", safePasswordRange)
    ).resolves.toBeUndefined();
  });

  test("ignores padded entries with a zero breach count", async () => {
    await expect(
      assertPasswordNotPwned("password", paddedOnlyRange)
    ).resolves.toBeUndefined();
  });

  test("fails closed when HIBP cannot be reached", async () => {
    await expect(
      assertPasswordNotPwned("a-unique-password", unavailablePasswordRange)
    ).rejects.toBeInstanceOf(PasswordSafetyError);
  });
});
