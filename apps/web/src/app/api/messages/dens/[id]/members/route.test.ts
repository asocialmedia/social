import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";
import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET, POST } from "./route";

// The roster route owns two decisions: that the caller is a member before any
// row is read, and that the roster it hands back is shaped for the details panel
// without naming anybody it should not. The add path additionally owns the
// order of its refusals, because the first message the caller sees has to name
// the actual problem rather than a downstream symptom of it.

class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "admin" } }));

const mockRequireDenMembership = mock(() => Promise.resolve({ role: "ADMIN" }));
const mockAddDenMembers = mock((_conversationId: string, _actorId: string) =>
  Promise.resolve(["user-3"])
);

// Candidate-screening inputs, read by den-candidates through the mocked orm.
// They are declared as plain lists rather than as pre-built failures so the real
// validateDenRoster runs and the refusal ordering it documents is what is tested.
let presentUserIds: string[] = [];
let identityUserIds: string[] = [];
let followedUserIds: string[] = [];

let rosterRows: Record<string, unknown>[] = [];
let requestedLimit = 0;

// The two directions of the block table, as the CANDIDATE's and the INCUMBENT's
// side of it. `blockRows` is a block row whose blocker is on one side and whose
// blocked is on the other, so the fixture can place the pair precisely.
//
// Nothing on this route reads it, and that is the point. A den admits regardless of
// blocks, so the fixtures below are there to pin the ABSENCE of the check, and a
// block row that nobody looked at proves nothing on its own. `blocksQueried` is the
// half that does: it is set by the mocked table, so an add path that reaches for
// Blocks again fails these tests rather than quietly passing them.
let blockRows: { blockerId: string; blockedId: string }[] = [];
let blocksQueried = false;

// Invokes a Prisma predicate against recording accessors, so a mocked table can
// answer from the constraints the query actually expressed rather than from a
// guess about which branch of the route called it.
function probeWhere(
  predicate: unknown,
  columns: string[]
): Record<string, unknown> {
  const seen: Record<string, unknown> = {};
  const accessors: Record<string, unknown> = {};
  for (const column of columns) {
    accessors[column] = {
      asc: () => "asc",
      desc: () => "desc",
      eq: (value: unknown) => {
        seen[column] = value;
        return {};
      },
      in: (value: unknown) => {
        seen[column] = value;
        return {};
      },
      isNotNull: () => ({}),
      isNull: () => ({}),
    };
  }
  (predicate as (value: unknown) => unknown)(accessors);
  return seen;
}

function restrict(ids: string[], seen: Record<string, unknown>): string[] {
  const requested = seen.id ?? seen.userId ?? seen.followingId;
  return Array.isArray(requested)
    ? requested.filter((id) => ids.includes(id as string))
    : ids;
}

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
  // The REAL limits, spread in. `@asm/db/messages/dens` is a different
  // module specifier from the mocked `@asm/db` barrel, so it resolves for real:
  // a hand-written copy here would be the one place in the repo where a den
  // limit is a literal, and a test double that quietly disagreed with the
  // module it stands in for is exactly the drift the consistency test exists to
  // catch.
  DEN_LIMITS: { ...DEN_LIMITS },
  DenError,
  addDenMembers: mockAddDenMembers,
  prisma: {
    orm: {
      public: {
        Blocks: {
          // A block is a row with two ids in it, and the two directions of the pair
          // are different column pairs, so this resolves against the predicate the
          // query actually expressed rather than against a guess.
          //
          // It is on this route's mock at all only so `blocksQueried` can catch a
          // check that comes back. Returning rows would let a reintroduced door
          // check pass the "admits" tests by accident if it happened to look the
          // wrong way.
          select: (field: string) => {
            const builder = {
              all: () => {
                blocksQueried = true;
                const seen = probeWhere(pendingBlocks, [
                  "blockerId",
                  "blockedId",
                ]);
                const blockers = (seen.blockerId as string[] | undefined) ?? [];
                const blocked = (seen.blockedId as string[] | undefined) ?? [];
                return blockRows
                  .filter(
                    (row) =>
                      blockers.includes(row.blockerId) &&
                      blocked.includes(row.blockedId)
                  )
                  .map((row) => ({
                    [field]: row[field as "blockerId" | "blockedId"],
                  }));
              },
              first: () => {
                blocksQueried = true;
                return null;
              },
              where: (predicate: unknown) => {
                blocksQueried = true;
                pendingBlocks = predicate;
                return builder;
              },
            };
            return builder;
          },
        },
        Follows: {
          select: (...fields: string[]) => {
            const builder = {
              all: () => {
                const seen = probeWhere(pendingFollows, [
                  "followerId",
                  "followingId",
                ]);
                return restrict(followedUserIds, seen).map((id) => ({
                  [fields[0] as string]: id,
                }));
              },
              where: (predicate: unknown) => {
                pendingFollows = predicate;
                return builder;
              },
            };
            return builder;
          },
        },
        MessageConversationMembers: {
          select: () => {
            // The roster chain is select().include().where().orderBy().limit().all()
            // on the GET, and the shorter select().where().all() the add path uses
            // to count the incumbent roster against the member cap. One mock serves
            // both, because both read the same table and must not be able to
            // disagree about how big the den is.
            const builder = {
              all: () =>
                requestedLimit > 0
                  ? rosterRows.slice(0, requestedLimit)
                  : rosterRows,
              include: (_relation: string, include: unknown) => {
                (include as (candidate: { select: () => void }) => void)({
                  select: () => {},
                });
                return builder;
              },
              limit: (value: number) => {
                requestedLimit = value;
                return builder;
              },
              orderBy: () => builder,
              where: (predicate: unknown) => {
                probeWhere(predicate, ["conversationId", "createdAt", "role"]);
                return builder;
              },
            };
            return builder;
          },
        },
        MessageConversations: { select: () => ({ where: () => ({}) }) },
        MessageIdentities: {
          select: (...fields: string[]) => {
            const builder = {
              all: () =>
                restrict(
                  identityUserIds,
                  probeWhere(pendingIdentities, ["userId"])
                ).map((id) => ({ [fields[0] as string]: id })),
              where: (predicate: unknown) => {
                pendingIdentities = predicate;
                return builder;
              },
            };
            return builder;
          },
        },
        Users: {
          select: (...fields: string[]) => {
            const builder = {
              all: () =>
                restrict(presentUserIds, probeWhere(pendingUsers, ["id"])).map(
                  (id) => ({ [fields[0] as string]: id })
                ),
              where: (predicate: unknown) => {
                pendingUsers = predicate;
                return builder;
              },
            };
            return builder;
          },
        },
      },
    },
  },
  requireDenMembership: mockRequireDenMembership,
}));

// The predicates handed to `.where()` are kept so the matching `.all()` can
// evaluate them: the builder chain separates the two calls.
let pendingUsers: unknown = null;
let pendingIdentities: unknown = null;
let pendingFollows: unknown = null;
let pendingBlocks: unknown = null;

// A membership row as the roster query returns it: the member's public identity
// comes through the include, so `user.id` and `userId` are the same person.
function roster(
  userId: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    invitedById: "owner",
    role: "MEMBER",
    user: {
      avatarUrl: null,
      badge: null,
      badges: [],
      displayName: "Person",
      id: userId,
      username: userId,
    },
    ...overrides,
    userId,
  };
}

function params(id = "den-1") {
  return { params: Promise.resolve({ id }) };
}

function getRoster(query = "", id = "den-1") {
  return GET(
    new Request(
      `http://localhost:3000/api/messages/dens/${id}/members${query}`
    ),
    params(id)
  );
}

function add(body: unknown, id = "den-1") {
  return POST(
    new Request(`http://localhost:3000/api/messages/dens/${id}/members`, {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    params(id)
  );
}

describe("GET /api/messages/dens/:id/members", () => {
  beforeEach(() => {
    requestedLimit = 0;
    rosterRows = [roster("owner", { role: "OWNER" }), roster("user-2")];
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "admin" } });
    mockRequireDenMembership.mockClear();
    mockRequireDenMembership.mockImplementation(() =>
      Promise.resolve({ role: "ADMIN" })
    );
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await getRoster();
    expect(res.status).toBe(401);
  });

  test("refuses a non-member before reading a single row", async () => {
    mockRequireDenMembership.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "You are not a member of this den")
    );
    const res = await getRoster();
    expect(res.status).toBe(403);
    expect(requestedLimit).toBe(0);
  });

  test("refuses a DM with 409, not a plausible-looking roster", async () => {
    mockRequireDenMembership.mockRejectedValueOnce(
      new DenError("NOT_A_DEN", "That is not a den")
    );
    const res = await getRoster("", "dm-1");
    expect(res.status).toBe(409);
  });

  test("returns the roster with each member's public identity", async () => {
    const res = await getRoster();
    const body = (await res.json()) as { members: Record<string, unknown>[] };
    expect(res.status).toBe(200);
    expect(body.members).toHaveLength(2);
    expect(body.members[1]).toEqual({
      avatarUrl: null,
      badge: null,
      badges: [],
      displayName: "Person",
      id: "user-2",
      invitedById: "owner",
      role: "MEMBER",
      username: "user-2",
    });
  });

  test("drops a membership row whose user was deleted underneath it", async () => {
    // flatMap rather than map: a nameless entry in a member list reads as a real
    // person and is unclickable.
    rosterRows = [
      roster("owner", { role: "OWNER" }),
      roster("ghost", { user: null }),
    ];
    const res = await getRoster();
    const body = (await res.json()) as { members: Record<string, unknown>[] };
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.id).toBe("owner");
  });

  test("defaults the page to 50 and caps it at the member ceiling", async () => {
    // Without a ceiling a crafted ?limit asks Postgres for the whole roster,
    // and this route is reachable by every member of a full den. Driven off
    // DEN_LIMITS rather than a literal so the assertion follows the constant: a
    // hardcoded clamp of 100 would pass a literal-100 test and fail this one the
    // moment the ceiling moved.
    await getRoster();
    expect(requestedLimit).toBe(50);
    await getRoster(`?limit=${DEN_LIMITS.membersMax + 1}`);
    expect(requestedLimit).toBe(DEN_LIMITS.membersMax);
    // The ceiling itself is legal, not off by one.
    await getRoster(`?limit=${DEN_LIMITS.membersMax}`);
    expect(requestedLimit).toBe(DEN_LIMITS.membersMax);
  });

  test("ignores a nonsense limit rather than clamping it to zero rows", async () => {
    await getRoster("?limit=abc");
    expect(requestedLimit).toBe(50);
    await getRoster("?limit=0");
    expect(requestedLimit).toBe(1);
  });
});

describe("POST /api/messages/dens/:id/members", () => {
  beforeEach(() => {
    // The roster mock pages on `requestedLimit`, which the GET suite above leaves
    // set to whatever its last `?limit=` was. Reset here so the incumbent roster
    // this suite reads is the whole roster and not the first row of it.
    requestedLimit = 0;
    // The roster before the addition, which is what the cap pre-check counts. `admin`
    // is the manager making the call and `user-2` is somebody already inside. The
    // block tests vary the block rows without ever involving the manager or the size
    // of the den, because neither decides anything: a den admits regardless of blocks
    // and the count only has to be under the ceiling.
    rosterRows = [roster("admin", { role: "ADMIN" }), roster("user-2")];
    presentUserIds = ["admin", "user-2", "user-3", "user-4"];
    identityUserIds = ["admin", "user-2", "user-3", "user-4"];
    followedUserIds = ["admin", "user-2", "user-3", "user-4"];
    blockRows = [];
    blocksQueried = false;
    pendingBlocks = null;
    pendingFollows = null;
    pendingIdentities = null;
    pendingUsers = null;
    mockAddDenMembers.mockClear();
    mockAddDenMembers.mockImplementation(() => Promise.resolve(["user-3"]));
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "admin" } });
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(401);
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("rejects a memberIds that is not a list", async () => {
    const res = await add({ memberIds: "user-3" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "INVALID_INPUT",
      error: "memberIds must be a list",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("rejects a list holding something that is not a user id", async () => {
    const res = await add({ memberIds: ["user-3", 7] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "INVALID_INPUT",
      error: "memberIds must hold user ids",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("rejects an empty roster with a message about the roster", async () => {
    const res = await add({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "memberIds is required" });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("reports an account that no longer exists as 404, not as a follow problem", async () => {
    presentUserIds = ["admin", "user-2"];
    const res = await add({ memberIds: ["user-2", "ghost"] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "NOT_FOUND",
      error: "Some of those accounts no longer exist",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("reports a member without Messages before the follow rule", async () => {
    // Ordered that way on purpose: somebody who has not enabled Messages should
    // be told to enable Messages, not that they need to follow a person who
    // would not be able to read the den anyway.
    identityUserIds = ["admin", "user-2"];
    followedUserIds = ["admin", "user-2"];
    const res = await add({ memberIds: ["user-2", "user-3"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "NO_IDENTITY",
      error: "Some of those people haven't enabled Messages yet",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("refuses somebody the caller does not follow", async () => {
    followedUserIds = ["admin", "user-2"];
    const res = await add({ memberIds: ["user-2", "user-3"] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "FOLLOW_REQUIRED",
      error: "You can only add people you follow",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("admits a candidate blocked with somebody already inside", async () => {
    // A den admits regardless of who blocks whom. `user-2` is already inside and
    // holds the block; the candidate is admitted anyway, because a room of up to a
    // hundred people is not something one pair's disagreement gets to veto. The
    // block row is placed here rather than left out on purpose: the route does not
    // read it, and this test is what proves it does not.
    blockRows = [{ blockedId: "user-4", blockerId: "user-2" }];
    const res = await add({ memberIds: ["user-4"] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: ["user-3"], ok: true });
    expect(mockAddDenMembers).toHaveBeenCalledWith("den-1", "admin", [
      "user-4",
    ]);
    expect(blocksQueried).toBe(false);
  });

  test("admits a candidate who blocked somebody already inside", async () => {
    // The other direction of the same pair. It used to be a separate 403 because a
    // block is symmetric in its effect on a DM and the two directions are different
    // column pairs - which is exactly why this test still exists after the check
    // it pins is gone. A reintroduced check that only probed one of the two
    // directions would pass one of these two tests and fail the other.
    blockRows = [{ blockedId: "user-2", blockerId: "user-4" }];
    const res = await add({ memberIds: ["user-4"] });
    expect(res.status).toBe(201);
    expect(mockAddDenMembers).toHaveBeenCalledTimes(1);
    expect(blocksQueried).toBe(false);
  });

  test("admits a whole roster that holds a blocked pair", async () => {
    // The strongest form of the removal: two candidates, blocked with each other
    // and with somebody already inside, in a single all-or-nothing request. The
    // old door refused this whole request - including the innocent candidate who
    // had nothing to do with it - which is the blast radius that made the rule
    // untenable rather than merely wrong.
    blockRows = [
      { blockedId: "user-3", blockerId: "user-4" },
      { blockedId: "user-2", blockerId: "user-3" },
      { blockedId: "user-4", blockerId: "admin" },
    ];
    const res = await add({ memberIds: ["user-3", "user-4"] });
    expect(res.status).toBe(201);
    expect(mockAddDenMembers).toHaveBeenCalledWith("den-1", "admin", [
      "user-3",
      "user-4",
    ]);
    expect(blocksQueried).toBe(false);
  });

  test("admits a candidate whose only block is with somebody outside the den", async () => {
    // Kept because it is the cheapest statement of what a block IS: it is between
    // two accounts, and it does not follow either of them into a room. The rule
    // that used to read it made this the "positive case", which was only ever a
    // guard against a misreading - it can no longer be refused by anything.
    blockRows = [{ blockedId: "user-4", blockerId: "outsider" }];
    const res = await add({ memberIds: ["user-4"] });
    expect(res.status).toBe(201);
    expect(mockAddDenMembers).toHaveBeenCalledTimes(1);
    expect(blocksQueried).toBe(false);
  });

  test("admits a whole roster when there is no block anywhere near it", async () => {
    // The control. If any of the tests above were passing because the route skips
    // the block check for some other reason - a fixture that never wrote a row, a
    // roster the check could not see - this would be the one that noticed, and it
    // is the only one here that does not depend on a block existing at all.
    const res = await add({ memberIds: ["user-3", "user-4"] });
    expect(res.status).toBe(201);
    expect(mockAddDenMembers).toHaveBeenCalledTimes(1);
  });

  test("refuses the addition that would cross the member ceiling", async () => {
    rosterRows = Array.from(
      { length: DEN_LIMITS.membersMax },
      (_unused, index) =>
        roster(index === 0 ? "admin" : `filler-${index}`, { role: "ADMIN" })
    );
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "LIMIT_REACHED",
      error: `A den can have at most ${DEN_LIMITS.membersMax} members`,
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("refuses a roster of only the caller", async () => {
    const res = await add({ memberIds: ["admin"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "MEMBERS_REQUIRED",
      error: "Add at least one other person",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("spends the add-members budget, and only for the write", async () => {
    // The roster READ is not metered. It is a bounded, indexed, membership-gated
    // page, and putting a budget on it would only throttle a details panel
    // scrolling its own list.
    await getRoster();
    expect(chargedBuckets).toEqual([]);
    await add({ memberIds: ["user-3"] });
    expect(chargedBuckets).toEqual([DEN_ADD_MEMBERS_RATE_LIMIT.bucket]);
  });

  test("answers 429 without adding anybody when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(429);
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("returns the ids actually added, not the ids requested", async () => {
    // A client that asked for five people and got three has to know which three,
    // because the root key is rotated for exactly those.
    mockAddDenMembers.mockImplementationOnce(() => Promise.resolve(["user-2"]));
    const res = await add({ memberIds: ["user-3", "user-2"] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: ["user-2"], ok: true });
  });

  test("forwards a sorted, deduped roster to the service", async () => {
    await add({ memberIds: ["user-3", "user-2", "user-3"] });
    expect(mockAddDenMembers).toHaveBeenCalledWith("den-1", "admin", [
      "user-2",
      "user-3",
    ]);
  });

  test("maps a domain refusal from the service", async () => {
    mockAddDenMembers.mockRejectedValueOnce(
      new DenError(
        "LIMIT_REACHED",
        `A den can have at most ${DEN_LIMITS.membersMax} members`
      )
    );
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "LIMIT_REACHED",
      error: `A den can have at most ${DEN_LIMITS.membersMax} members`,
    });
  });
});
