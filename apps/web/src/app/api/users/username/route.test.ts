import { beforeEach, describe, expect, mock, test } from "bun:test";

import { PATCH } from "./route";

const USER = { id: "user-1" };

const state = {
  committedLower: new Set<string>(),
  existingUser: null as { id: string } | null,
  session: { user: USER },
  throwP2002: false as boolean,
  updateCalled: false as boolean,
};

function resetState() {
  state.committedLower = new Set();
  state.existingUser = null;
  state.session = { user: USER };
  state.throwP2002 = false;
  state.updateCalled = false;
}

class PrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super(`Prisma ${code}`);
    this.name = "PrismaKnownError";
    this.code = code;
  }
}

const MockPrismaKnownError = PrismaKnownError;

const mockPrisma = {
  user: {
    findFirst: (_args: {
      where: { username: { equals: string; mode: string } };
    }) => state.existingUser,
    update: (args: { data: { username: string } }) => {
      state.updateCalled = true;
      const lower = args.data.username.toLowerCase();
      if (state.committedLower.has(lower)) {
        throw new MockPrismaKnownError("P2002");
      }
      if (state.throwP2002) {
        throw new MockPrismaKnownError("P2002");
      }
      state.committedLower.add(lower);
      return { id: USER.id };
    },
  },
};

mock.module("@asm/db", () => ({
  Prisma: {
    PrismaClientKnownRequestError: MockPrismaKnownError,
  },
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: () => state.session,
}));

function patchRequest(username: string): Request {
  return new Request("http://localhost/api/users/username", {
    body: JSON.stringify({ username }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

describe("PATCH /api/users/username", () => {
  beforeEach(() => {
    resetState();
  });

  test("rejects unauthenticated requests", async () => {
    state.session = null;
    const res = await PATCH(patchRequest("newhandle"));
    expect(res.status).toBe(401);
    expect(state.updateCalled).toBe(false);
  });

  test("rejects an invalid username", async () => {
    const res = await PATCH(patchRequest("bad name!"));
    expect(res.status).toBe(400);
    expect(state.updateCalled).toBe(false);
  });

  test("rejects a taken username case-insensitively", async () => {
    state.existingUser = { id: "other-user" };
    const res = await PATCH(patchRequest("John"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Username is already taken");
    expect(state.updateCalled).toBe(false);
  });

  test("allows updating to a username that is yours in a different case", async () => {
    state.existingUser = { id: USER.id };
    const res = await PATCH(patchRequest("NewHandle"));
    expect(res.status).toBe(200);
    expect(state.updateCalled).toBe(true);
  });

  test("returns 400 (not 500) when the DB unique constraint fires", async () => {
    state.throwP2002 = true;
    const res = await PATCH(patchRequest("racey"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Username is already taken");
  });

  test("concurrent casing variants: only one succeeds", async () => {
    // Simulate a race: both pre-checks pass (no existing user), the first
    // update commits and the second hits the case-insensitive unique index.
    const results = await Promise.all([
      PATCH(patchRequest("John")),
      PATCH(patchRequest("john")),
    ]);
    const statuses = results.map((r) => r.status);
    const has200 = statuses.some((s) => s === 200);
    const has400 = statuses.some((s) => s === 400);
    expect(has200).toBe(true);
    expect(has400).toBe(true);
  });
});
