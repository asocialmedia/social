import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockGetSession = mock();
const mockAssertPasswordNotPwned = mock();
const mockHashPasswordWithScrypt = mock();
const mockUserFindUnique = mock();
const mockAccountFindFirst = mock();
const mockAccountCreate = mock();
const mockAccountUpdate = mock();
const mockUserUpdate = mock();

class MockPasswordSafetyError extends Error {
  readonly reason: "compromised" | "unavailable";

  constructor(reason: "compromised" | "unavailable") {
    super(
      reason === "compromised"
        ? "This password has appeared in a data breach. Please choose a different password."
        : "Password safety check is unavailable. Please try again shortly."
    );
    this.name = "MockPasswordSafetyError";
    this.reason = reason;
  }
}

const transactionClient = {
  account: {
    create: mockAccountCreate,
    findFirst: mockAccountFindFirst,
    update: mockAccountUpdate,
  },
  user: {
    findUnique: mockUserFindUnique,
    update: mockUserUpdate,
  },
};

async function runTransaction(
  operation: (transaction: typeof transactionClient) => unknown
): Promise<unknown> {
  return await operation(transactionClient);
}

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/auth/core", () => ({
  PasswordSafetyError: MockPasswordSafetyError,
  assertPasswordNotPwned: mockAssertPasswordNotPwned,
  hashPasswordWithScrypt: mockHashPasswordWithScrypt,
}));

mock.module("@asm/db", () => ({
  prisma: {
    $transaction: runTransaction,
    account: transactionClient.account,
    user: transactionClient.user,
  },
}));

const { POST } = await import("./route");

function passwordRequest(password = "valid-password"): Request {
  return new Request("http://localhost/api/users/password", {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/users/password", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockAssertPasswordNotPwned.mockReset();
    mockHashPasswordWithScrypt.mockReset();
    mockUserFindUnique.mockReset();
    mockAccountFindFirst.mockReset();
    mockAccountCreate.mockReset();
    mockAccountUpdate.mockReset();
    mockUserUpdate.mockReset();

    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAssertPasswordNotPwned.mockResolvedValue();
    mockHashPasswordWithScrypt.mockResolvedValue("scrypt$hashed-password");
    mockUserFindUnique.mockResolvedValue({
      email: "member@example.com",
      emailVerified: true,
    });
    mockAccountFindFirst.mockResolvedValue(null);
    mockAccountCreate.mockResolvedValue({ id: "credential-1" });
    mockAccountUpdate.mockResolvedValue({ id: "credential-1" });
    mockUserUpdate.mockResolvedValue({ id: "user-1" });
  });

  test("requires an authenticated user", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await POST(passwordRequest());

    expect(response.status).toBe(401);
    expect(mockAssertPasswordNotPwned).not.toHaveBeenCalled();
  });

  test("requires a verified recovery email before a credential is created", async () => {
    mockUserFindUnique.mockResolvedValue({
      email: "member@example.com",
      emailVerified: false,
    });

    const response = await POST(passwordRequest());

    expect(response.status).toBe(400);
    expect(mockAssertPasswordNotPwned).not.toHaveBeenCalled();
    expect(mockAccountCreate).not.toHaveBeenCalled();
  });

  test("creates a Better Auth credential account and mirrors the hash", async () => {
    const response = await POST(passwordRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockAssertPasswordNotPwned).toHaveBeenCalledWith("valid-password");
    expect(mockAccountCreate).toHaveBeenCalledWith({
      data: {
        accountId: "user-1",
        issuer: "local:credential",
        password: "scrypt$hashed-password",
        providerId: "credential",
        userId: "user-1",
      },
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      data: { passwordHash: "scrypt$hashed-password" },
      where: { id: "user-1" },
    });
  });

  test("does not overwrite an existing password", async () => {
    mockAccountFindFirst.mockResolvedValue({
      id: "credential-1",
      password: "existing-hash",
    });

    const response = await POST(passwordRequest());

    expect(response.status).toBe(409);
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  test("surfaces a safe pwned-password message", async () => {
    mockAssertPasswordNotPwned.mockRejectedValue(
      new MockPasswordSafetyError("compromised")
    );

    const response = await POST(passwordRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("data breach");
    expect(mockHashPasswordWithScrypt).not.toHaveBeenCalled();
  });
});
