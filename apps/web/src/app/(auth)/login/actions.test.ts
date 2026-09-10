import { beforeEach, describe, expect, mock, test } from "bun:test";

const emailSignIn = mock();
const usernameSignIn = mock();

mock.module("@/lib/auth/auth", () => ({
  authClient: {
    signIn: {
      email: emailSignIn,
      username: usernameSignIn,
    },
  },
}));

const { login } = await import("./actions");

describe("login", () => {
  beforeEach(() => {
    emailSignIn.mockReset();
    usernameSignIn.mockReset();
  });

  test("uses the username endpoint and accepts a successful response", async () => {
    usernameSignIn.mockResolvedValue({
      data: { token: "session" },
      error: null,
    });

    await expect(
      login({ password: "not-a-real-password", username: "creator" })
    ).resolves.toEqual({ success: true });
    expect(usernameSignIn).toHaveBeenCalledWith({
      password: "not-a-real-password",
      username: "creator",
    });
  });

  test("returns an invalid-credentials result when Better Auth resolves an error", async () => {
    emailSignIn.mockResolvedValue({
      data: null,
      error: { message: "Invalid email or password" },
    });

    await expect(
      login({
        password: "not-a-real-password",
        username: "creator@example.com",
      })
    ).resolves.toEqual({
      error: "Invalid username/email or password",
      success: false,
    });
  });

  test("preserves a structured account suspension response", async () => {
    usernameSignIn.mockResolvedValue({
      data: null,
      error: {
        message: JSON.stringify({
          banExpires: "2030-01-01T00:00:00.000Z",
          banReason: "Repeated policy violations",
          code: "USER_BANNED",
        }),
      },
    });

    const result = await login({
      password: "not-a-real-password",
      username: "creator",
    });

    expect(result).toMatchObject({
      banExpires: "2030-01-01T00:00:00.000Z",
      banReason: "Repeated policy violations",
      banned: true,
      success: false,
    });
  });
});
