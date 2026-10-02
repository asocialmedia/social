import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";
import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  DEN_DETAILS_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET, PATCH } from "./route";

// The route is the authority on nothing here: it forwards to the service and
// shapes the answer. What it owns, and what these tests pin, is the session
// gate, the body parsing that has to reject before it reaches the service, the
// invite-code disclosure rule, and the error-to-status mapping the client
// branches on.

// The error class is redefined rather than imported so a throw in a test is
// recognisable to the route's `error instanceof DenError` check, which sees the
// class this mock module exports. The code union is still read off the real
// class, so a new code cannot be added to the service without this file noticing.
class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "member" } }));

interface DenMembership {
  role: "ADMIN" | "MEMBER" | "OWNER";
}
// Read at call time, so a test changes the role by assigning to this rather
// than by re-registering the mock.
let membership: DenMembership = { role: "OWNER" };
const mockRequireDenMembership = mock(() => Promise.resolve(membership));

interface DenRow {
  avatarMediaId: string | null;
  description: string | null;
  inviteCode: string | null;
  name: string | null;
  ownerId: string;
}
let denRow: DenRow | null = {
  avatarMediaId: null,
  description: "a den",
  inviteCode: "code-abcdefghijk",
  name: "game night",
  ownerId: "owner",
};
let memberCount = 3;

const mockUpdateDenDetails = mock(
  (_conversationId: string, _actorId: string, _input: unknown) =>
    Promise.resolve()
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// Which bucket each call was handed, so a test can say WHICH budget an operation
// spends rather than only that a limiter was consulted.
const chargedBuckets: string[] = [];
const mockConsumeDenRateLimit = mock((rule: { bucket: string }) => {
  chargedBuckets.push(rule.bucket);
  return Promise.resolve(null);
});
mock.module("@/lib/messages/den-rate-limit", () =>
  denRateLimitDouble(mockConsumeDenRateLimit)
);

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  // The real limits, spread in; see the note in the members route test.
  DEN_LIMITS: { ...DEN_LIMITS },
  DenError,
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          where: () => ({
            aggregate: (
              aggregate: (value: { count: () => number }) => unknown
            ) => aggregate({ count: () => memberCount }),
          }),
        },
        MessageConversations: {
          // Chainable rather than a fixed object: the route chains
          // .select().where().first(), and a stub that only answered the last
          // call would pass while the query it stands in for never ran.
          select: () => {
            const builder = {
              first: () => Promise.resolve(denRow),
              where: () => builder,
            };
            return builder;
          },
        },
      },
    },
  },
  requireDenMembership: mockRequireDenMembership,
  updateDenDetails: mockUpdateDenDetails,
}));

function params(id = "den-1") {
  return { params: Promise.resolve({ id }) };
}

function get(id = "den-1") {
  return GET(
    new Request("http://localhost:3000/api/messages/dens/den-1"),
    params(id)
  );
}

function patch(body: unknown, id = "den-1") {
  return PATCH(
    new Request("http://localhost:3000/api/messages/dens/den-1", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }),
    params(id)
  );
}

describe("GET /api/messages/dens/:id", () => {
  beforeEach(() => {
    membership = { role: "OWNER" };
    memberCount = 3;
    denRow = {
      avatarMediaId: null,
      description: "a den",
      inviteCode: "code-abcdefghijk",
      name: "game night",
      ownerId: "owner",
    };
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "member" } });
    mockRequireDenMembership.mockClear();
    mockRequireDenMembership.mockImplementation(() =>
      Promise.resolve(membership)
    );
    mockUpdateDenDetails.mockClear();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await get();
    expect(res.status).toBe(401);
    // The gate is the session, so nothing downstream is touched at all.
    expect(mockRequireDenMembership).not.toHaveBeenCalled();
  });

  test("answers 404 for a den that does not exist", async () => {
    mockRequireDenMembership.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "Den not found")
    );
    const res = await get("missing");
    expect(res.status).toBe(404);
  });

  test("answers 409 for a DM, so the route cannot read a private thread", async () => {
    mockRequireDenMembership.mockRejectedValueOnce(
      new DenError("NOT_A_DEN", "That is not a den")
    );
    const res = await get("dm-1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "NOT_A_DEN",
      error: "That is not a den",
    });
  });

  test("answers 403 for somebody who is not a member", async () => {
    mockRequireDenMembership.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "You are not a member of this den")
    );
    const res = await get();
    expect(res.status).toBe(403);
  });

  test("404s when the conversation row disappears behind the gate", async () => {
    // requireDenMembership reads the row and then the route reads it again for
    // the payload. A dissolve landing between the two must be a 404, not a
    // response built from a missing row.
    mockRequireDenMembership.mockImplementationOnce(() => {
      denRow = null;
      return { role: "OWNER" };
    });
    const res = await get();
    expect(res.status).toBe(404);
  });

  test("answers 500 for a failure that is not a domain outcome", async () => {
    mockRequireDenMembership.mockRejectedValueOnce(new Error("boom"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't complete that, try again?",
    });
  });

  test("withholds the invite code from a plain member", async () => {
    membership = { role: "MEMBER" };
    const res = await get();
    const body = (await res.json()) as {
      canManage: boolean;
      den: { inviteCode: string | null };
      membership: DenMembership;
    };
    expect(res.status).toBe(200);
    // The code is the ability to add strangers, so a member who can see the den
    // exists must not receive the door.
    expect(body.den.inviteCode).toBeNull();
    expect(body.canManage).toBe(false);
    expect(body.membership).toEqual({ role: "MEMBER" });
  });

  test("returns the invite code and canManage to an owner", async () => {
    membership = { role: "OWNER" };
    const res = await get();
    const body = (await res.json()) as {
      canManage: boolean;
      den: { inviteCode: string | null; memberCount: number; ownerId: string };
      membership: DenMembership;
    };
    expect(res.status).toBe(200);
    expect(body.den.inviteCode).toBe("code-abcdefghijk");
    expect(body.canManage).toBe(true);
    expect(body.membership).toEqual({ role: "OWNER" });
    expect(body.den.memberCount).toBe(3);
    expect(body.den.ownerId).toBe("owner");
  });

  test("returns the invite code to an admin too", async () => {
    membership = { role: "ADMIN" };
    const res = await get();
    const body = (await res.json()) as { den: { inviteCode: string | null } };
    expect(body.den.inviteCode).toBe("code-abcdefghijk");
  });
});

describe("PATCH /api/messages/dens/:id", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "member" } });
    mockUpdateDenDetails.mockClear();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await patch({ name: "renamed" });
    expect(res.status).toBe(401);
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("rejects a body that is not an object", async () => {
    // Malformed JSON, a list, and a bare string all have to be 400s, and none
    // of them may reach the service.
    for (const body of ["{not json", "[1,2]", '"nope"', "null"]) {
      // oxlint-disable-next-line no-await-in-loop -- one assertion per shape, sequential on purpose
      const res = await patch(body);
      expect(res.status).toBe(400);
    }
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("rejects a name that is not a string", async () => {
    const res = await patch({ name: 7 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name must be a string" });
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("rejects a description that is not a string or null", async () => {
    const res = await patch({ description: ["nope"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "description must be a string",
    });
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("rejects an avatarMediaId that is not a string or null", async () => {
    const res = await patch({ avatarMediaId: 12 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "avatarMediaId must be a string",
    });
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("rejects an empty patch rather than writing a no-op update", async () => {
    const res = await patch({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing to update" });
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("forwards only the fields the client sent", async () => {
    // PATCH rather than PUT: a rename must not require resending the fields the
    // client did not mean to change.
    const res = await patch({ name: "  game   night " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockUpdateDenDetails).toHaveBeenCalledTimes(1);
    expect(mockUpdateDenDetails).toHaveBeenCalledWith("den-1", "member", {
      name: "  game   night ",
    });
  });

  test("forwards an explicit null description as a clear, not an omission", async () => {
    // null clears and absent leaves alone, so the two cannot collapse into one
    // answer and a details panel never has to guess which one it received.
    const res = await patch({ description: null });
    expect(res.status).toBe(200);
    expect(mockUpdateDenDetails).toHaveBeenCalledWith("den-1", "member", {
      description: null,
    });
  });

  test("forwards every field together when they are all sent", async () => {
    const res = await patch({
      avatarMediaId: "media-1",
      description: "sundays",
      name: "den",
    });
    expect(res.status).toBe(200);
    expect(mockUpdateDenDetails).toHaveBeenCalledWith("den-1", "member", {
      avatarMediaId: "media-1",
      description: "sundays",
      name: "den",
    });
  });

  test("spends the details budget, not one a role change also spends", async () => {
    // The split this pass made. A rename is the one management operation a client
    // can put in a loop - a save behind an autosave, a retry per keystroke - so it
    // used to share a bucket with role changes, and a loop could spend the whole
    // budget and leave the owner unable to promote anybody for an hour.
    const res = await patch({ name: "renamed" });
    expect(res.status).toBe(200);
    expect(chargedBuckets).toEqual([DEN_DETAILS_RATE_LIMIT.bucket]);
  });

  test("answers 429 without touching the service when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await patch({ name: "renamed" });
    expect(res.status).toBe(429);
    expect(mockUpdateDenDetails).not.toHaveBeenCalled();
  });

  test("maps a domain refusal from the service", async () => {
    mockUpdateDenDetails.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Only the owner or an elder can do that")
    );
    const res = await patch({ name: "renamed" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "FORBIDDEN",
      error: "Only the owner or an elder can do that",
    });
  });

  test("validates the body before spending the rate limit budget", async () => {
    await patch({ name: 7 });
    expect(mockConsumeDenRateLimit).not.toHaveBeenCalled();
  });
});

describe("denErrorResponse status mapping", () => {
  // Every code the service can throw, answered through a real route rather than
  // by calling the helper directly, so a route that stops routing an error
  // through denErrorResponse fails here too.
  beforeEach(() => {
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "member" } });
  });

  const cases = [
    ["ALREADY_MEMBER", 409],
    ["FORBIDDEN", 403],
    ["INVALID_INPUT", 400],
    ["INVALID_ROLE", 400],
    ["LIMIT_REACHED", 409],
    ["MEMBERS_REQUIRED", 400],
    ["NOT_A_DEN", 409],
    ["NOT_FOUND", 404],
    ["SELF_ACTION", 409],
  ] as const satisfies readonly (readonly [DenErrorClass["code"], number])[];

  for (const [code, status] of cases) {
    test(`maps ${code} to ${status}`, async () => {
      mockRequireDenMembership.mockRejectedValueOnce(
        new DenError(code, `den refused with ${code}`)
      );
      const res = await get();
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({
        code,
        error: `den refused with ${code}`,
      });
    });
  }
});
