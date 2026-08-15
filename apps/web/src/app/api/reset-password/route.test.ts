import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const TOKEN = "reset-token-123";

// The route reads `req.nextUrl.searchParams` (NextRequest). Provide a minimal
// stand-in so the handler works under bun:test.
class NextRequestStub {
  nextUrl: URL;
  constructor(url: string) {
    this.nextUrl = new URL(url);
  }
}

mock.module("next/server", () => ({ NextRequest: NextRequestStub }));

const state = {
  deletedId: null as string | null,
  expiresAt: new Date(Date.now() + 60_000),
  found: true as boolean,
  requestedIdentifier: null as string | null,
};

function resetState() {
  state.deletedId = null;
  state.expiresAt = new Date(Date.now() + 60_000);
  state.found = true;
  state.requestedIdentifier = null;
}

const mockPrisma = {
  verification: {
    delete: (args: { where: { id: string } }) => {
      state.deletedId = args.where.id;
      return Promise.resolve({});
    },
    findFirst: (args: { where: { identifier: string } }) => {
      state.requestedIdentifier = args.where.identifier;
      if (!state.found) {
        return Promise.resolve(null);
      }
      // Only match the better-auth reset-password:{token} identifier shape.
      if (!args.where.identifier.startsWith("reset-password:")) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        expiresAt: state.expiresAt,
        id: "verification-1",
      });
    },
  },
};

mock.module("@asm/db", () => ({ prisma: mockPrisma }));

function request(token: string | null): NextRequestStub {
  const url = new URL("http://localhost/api/reset-password");
  if (token) {
    url.searchParams.set("token", token);
  }
  return new NextRequestStub(url.toString());
}

describe("GET /api/reset-password", () => {
  beforeEach(() => {
    resetState();
  });

  test("rejects a missing token", async () => {
    const res = await GET(request(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid token");
  });

  test("rejects an unknown token", async () => {
    state.found = false;
    const res = await GET(request(TOKEN));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Token not found");
  });

  test("accepts a valid unexpired token", async () => {
    const res = await GET(request(TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: true });
    // The route must look up the better-auth identifier exactly as constructed.
    expect(state.requestedIdentifier).toBe(`reset-password:${TOKEN}`);
  });

  test("rejects an expired token and purges it", async () => {
    state.expiresAt = new Date(Date.now() - 1000);
    const res = await GET(request(TOKEN));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Token expired");
    expect(state.deletedId).toBe("verification-1");
  });

  test("does not match identifiers outside the reset-password prefix", async () => {
    // If the token were looked up with a raw identifier (no prefix), the
    // verification row would not resolve and the link would be rejected.
    state.found = true;
    const res = await GET(request(TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: true });
  });
});
