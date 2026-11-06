import { describe, expect, test } from "bun:test";

import {
  lastLoginMethodClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { lastLoginMethod, twoFactor } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";

describe("security plugins", () => {
  test("Better Auth test utilities build a client with email 2FA and last-login tracking", async () => {
    const { client } = await getTestInstance(
      {
        emailAndPassword: { enabled: true },
        plugins: [
          twoFactor({
            otpOptions: {
              sendOTP: () => {},
              storeOTP: "encrypted",
            },
          }),
          lastLoginMethod({ storeInDatabase: true }),
        ],
      },
      {
        clientOptions: {
          plugins: [twoFactorClient(), lastLoginMethodClient()],
        },
      }
    );

    expect(client.twoFactor.enable).toBeDefined();
    expect(client.twoFactor.sendOtp).toBeDefined();
    expect(client.getLastUsedLoginMethod).toBeDefined();
  });
});
