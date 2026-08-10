import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Session, User } from "@asm/auth/core";
import type { NextRequest } from "next/server";

type SessionResult = {
  session: Session;
  user: User;
} | null;

const mockGetSession = mock(async (): Promise<SessionResult> => null);

mock.module("@/auth/config", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

import { GET, OPTIONS } from "./route";

describe("GET /api/auth/get-session", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
  });

  test("returns 200 and null session if unauthorized", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const req = new Request(
      "http://localhost/api/auth/get-session"
    ) as unknown as NextRequest;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  test("returns 200 and session if authorized", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");

    mockGetSession.mockResolvedValueOnce({
      session: {
        id: "s1",
        userId: "u1",
        token: "token-1",
        expiresAt: now,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: "u1",
        email: "test@example.com",
        emailVerified: true,
        name: "test user",
        username: "testuser",
        createdAt: now,
        updatedAt: now,
      },
    });

    const req = new Request(
      "http://localhost/api/auth/get-session"
    ) as unknown as NextRequest;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("s1");
    expect(body.user.username).toBe("testuser");
  });

  test("handles OPTIONS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
