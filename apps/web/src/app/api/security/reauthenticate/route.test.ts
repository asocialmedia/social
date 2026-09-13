import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockGetSession = mock();
const mockConsumeRateLimit = mock();
const mockVerifyPasswordHash = mock();
const mockAccountFindFirst = mock();
const mockSessionUpdateMany = mock();

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/auth/core", () => ({
  verifyPasswordHash: mockVerifyPasswordHash,
}));

mock.module("@asm/db", () => ({
  consumeRateLimit: mockConsumeRateLimit,
  prisma: {
    account: { findFirst: mockAccountFindFirst },
    session: { updateMany: mockSessionUpdateMany },
  },
}));

const { POST } = await import("./route");

function reauthenticationRequest(password = "correct-password"): Request {
  return new Request("http://localhost/api/security/reauthenticate", {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/security/reauthenticate", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockConsumeRateLimit.mockReset();
    mockVerifyPasswordHash.mockReset();
    mockAccountFindFirst.mockReset();
    mockSessionUpdateMany.mockReset();

    mockGetSession.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1" },
    });
    mockConsumeRateLimit.mockResolvedValue({ allowed: true });
    mockAccountFindFirst.mockResolvedValue({ password: "stored-hash" });
    mockVerifyPasswordHash.mockResolvedValue(true);
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });
  });

  test("makes the existing verified session fresh without creating another", async () => {
    const response = await POST(reauthenticationRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockVerifyPasswordHash).toHaveBeenCalledWith(
      "correct-password",
      "stored-hash"
    );
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      data: { createdAt: expect.any(Date) },
      where: {
        expiresAt: { gt: expect.any(Date) },
        id: "session-1",
        userId: "user-1",
      },
    });
  });

  test("does not refresh a session when its password is incorrect", async () => {
    mockVerifyPasswordHash.mockResolvedValue(false);

    const response = await POST(reauthenticationRequest("wrong-password"));

    expect(response.status).toBe(401);
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });

  test("asks social-only accounts to set a password before continuing", async () => {
    mockAccountFindFirst.mockResolvedValue(null);

    const response = await POST(reauthenticationRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Set an account password before confirming this security change.",
    });
    expect(mockVerifyPasswordHash).not.toHaveBeenCalled();
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });

  test("rate limits password confirmation attempts", async () => {
    mockConsumeRateLimit.mockResolvedValue({ allowed: false });

    const response = await POST(reauthenticationRequest());

    expect(response.status).toBe(429);
    expect(mockVerifyPasswordHash).not.toHaveBeenCalled();
  });
});
