import { beforeEach, describe, expect, mock, test } from "bun:test";

import { NextRequest } from "next/server";

const mockGetSession = mock();
const mockUserUpdate = mock();
const fetchMock = mock();

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: { user: { update: mockUserUpdate } },
}));

globalThis.fetch = fetchMock;

const { POST } = await import("./route");

const googleContext = { params: Promise.resolve({ provider: "google" }) };

describe("POST /api/auth/unlink/:provider", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockUserUpdate.mockReset();
    fetchMock.mockReset();

    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserUpdate.mockResolvedValue({ id: "user-1" });
    fetchMock
      .mockResolvedValueOnce(
        Response.json([{ id: "account-1", providerId: "google" }])
      )
      .mockResolvedValueOnce(Response.json({ status: true }));
  });

  test("requires an authenticated session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost/api/auth/unlink/google", {
        method: "POST",
      }),
      googleContext
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("clears the mirrored provider id only after Better Auth unlinks", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/unlink/google", {
        method: "POST",
      }),
      googleContext
    );

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      data: { googleId: null },
      where: { id: "user-1" },
    });
  });
});
