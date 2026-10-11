import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";
import type { GroupAddPolicy } from "@asm/db/messages/dens";
import {
  DEN_LIMITS,
  groupAddRefusal,
  groupAddRefusalError,
} from "@asm/db/messages/dens";

import {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { probeWhere, probedIds } from "@/lib/messages/test-support/where-probe";
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
// The follow fixture is now the CANDIDATE -> ACTOR edge. `followingActorIds` are
// the candidates who follow "admin", the caller in this suite.
let followingActorIds: string[] = [];
// Each candidate's own group-add setting. Absent means the account default.
let policyById: Record<string, string> = {};

let rosterRows: Record<string, unknown>[] = [];
let requestedLimit = 0;
// The constraints the last roster read expressed. See the mock's `where` for why
// this exists rather than a fixture with a departed row in it.
let lastRosterWhere: Record<string, unknown> = {};

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

// The ids a mocked table was asked about, narrowed to the ones that exist.
//
// Three columns because the three tables this suite doubles are keyed differently - a
// block pair is two id columns and this is the single shape that reads all of them
// without each table having to describe its own. Falls back to every known id when the
// probe found no list, so a table whose mock was reached in a shape this does not
// recognise answers with the whole fixture rather than silently with nothing.
function restrict(ids: string[], seen: Record<string, unknown>): string[] {
  for (const column of ["id", "userId", "followingId"]) {
    const requested = probedIds(seen, column);
    if (requested.length > 0) {
      return requested.filter((id) => ids.includes(id));
    }
  }
  return ids;
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

// Which of the requested ids are banned from this den. A set because that is what the
// helper really returns, so a test cannot pass by returning an array that merely
// happens to be truthy.
// The authority gate the route now takes BEFORE its ban pre-check. Authorised by
// default, so every other test in this file reads as a manager and a refusal is about
// the ordering rather than about permission.
//
// A flag rather than `mockImplementationOnce`, because a queued one-shot implementation
// survives `mockClear` and leaks into whichever test runs next if the test that queued it
// never reaches the call. That produced an order-dependent failure here, which is the
// class of bug this file exists to be free of.
let managerRefusal: DenError | null = null;
const mockRequireDenManager = mock(
  (_conversationId: string, _actorId: string) =>
    managerRefusal
      ? Promise.reject(managerRefusal)
      : Promise.resolve({ role: "OWNER" })
);

const mockFilterBannedUserIds = mock(
  (_conversationId: string, _userIds: string[]) =>
    Promise.resolve(new Set<string>())
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
  // Nobody is banned unless a test says so. Stubbed rather than left to reach
  // `prisma`: the real helper would build a query against this mocked barrel and 500
  // on a bind it cannot express, which reads as a route bug and proves nothing about
  // bans.
  filterBannedUserIds: mockFilterBannedUserIds,
  // The group-add policy, answered from THIS file's fixtures.
  //
  // It has to be supplied rather than inherited, because it lives on the `@asm/db`
  // barrel - a module every route test replaces wholesale - and the sibling
  // conversations suite answers it permissively for its own den-create branch. Whichever
  // file registered a barrel last decided this suite's policy answers, which is how two
  // "somebody who allows no direct adds is refused" tests came back as successes in a
  // full run while passing alone.
  //
  // Only the DATA is faked. Both `groupAddRefusal` - which decides - and
  // `groupAddRefusalError` - which words it - are the real functions, read from
  // `@asm/db/messages/dens`, a different specifier from the mocked barrel so they resolve
  // for real. So this suite cannot drift from the policy or from the words the product
  // shows; only the two inputs are this file's.
  //
  // What genuinely cannot be had here is the real `groupAddRefusalFor` itself, because it
  // reads `users` and `follows` through the barrel this file replaces. These two functions
  // are its entire body. The rules are also proved against a database in
  // `den-group-add.integration.test.ts`; what this suite is about is what the route does
  // with an answer.
  groupAddRefusalFor: (actorId: string, candidateIds: readonly string[]) => {
    const followsActor = new Set(followingActorIds);
    for (const candidateId of new Set(candidateIds)) {
      // The actor is always a member, so their own policy is never a reason to refuse
      // them - the same exclusion the real eligibility read makes.
      if (candidateId === actorId) {
        continue;
      }
      const refusal = groupAddRefusal(
        (policyById[candidateId] ?? "FOLLOWING_ONLY") as GroupAddPolicy,
        followsActor.has(candidateId)
      );
      if (refusal !== null) {
        return { code: refusal, error: groupAddRefusalError(refusal) };
      }
    }
    return null;
  },
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
              // The edge is "which candidates follow the actor", because that is
              // what FOLLOWING_ONLY is written against - so the queried id array
              // arrives as `followerId` and the actor as `followingId`. Reading
              // `followerId` first is what makes a fixture written for the old
              // direction fail loudly instead of quietly answering the inverse
              // question and admitting everybody.
              all: () => {
                const seen = probeWhere(pendingFollows, [
                  "followerId",
                  "followingId",
                ]);
                const candidates = Array.isArray(seen.followerId)
                  ? (seen.followerId as string[])
                  : [];
                return candidates
                  .filter((id) => followingActorIds.includes(id))
                  .map((id) => ({ [fields[0] as string]: id }));
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
                // Kept, not discarded. A departed member staying on the roster is
                // invisible to a row-level assertion - the mock hands back whatever
                // rows it was given either way - so the only thing that can catch it
                // is the constraint the query actually expressed.
                lastRosterWhere = probeWhere(predicate, [
                  "conversationId",
                  "createdAt",
                  "leftAt",
                  "role",
                ]);
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
              // Answers both reads this route makes of `users`: the existence
              // check, which wants `{ id }`, and the group-add policy read, which
              // wants `{ groupAddPolicy, id }`. Keyed off the requested fields
              // rather than the call order, so adding a read cannot silently
              // repoint an existing one.
              all: () => {
                const seen = probeWhere(pendingUsers, ["id"]);
                const ids = restrict(presentUserIds, seen);
                if (fields.includes("groupAddPolicy")) {
                  return ids.map((id) => ({
                    groupAddPolicy: policyById[id] ?? "FOLLOWING_ONLY",
                    id,
                  }));
                }
                // Whatever the caller asked for, from the row this test describes. A
                // display name is EMPTY unless a test sets one, because an account
                // with no display name is a real state and the name read has a
                // fallback for it. Defaulting it to the id would make that fallback
                // unreachable and the branch untestable.
                return ids.map((id) => {
                  const row: Record<string, string> = { id };
                  for (const field of fields) {
                    if (field === "id") {
                      continue;
                    }
                    row[field] = fakeFieldValue(field, id);
                  }
                  return row;
                });
              },
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
  requireDenManager: mockRequireDenManager,
  requireDenMembership: mockRequireDenMembership,
}));

// The predicates handed to `.where()` are kept so the matching `.all()` can
// evaluate them: the builder chain separates the two calls.
let pendingUsers: unknown = null;
// Names for the rows above, for the read that has to NAME a banned candidate. An
// absent display name means the account has none, and an absent username falls back to
// the id, so a test asserting on a name has to set one and cannot pass by accident.
const displayNameById: Record<string, string> = {};
const usernameById: Record<string, string> = {};

// One requested field, answered from the tables above. A function rather than an
// expression because the choice between the two names is not a ternary's job: a name
// the test did not set has a DIFFERENT default depending on which field it is, and
// folding that into one expression is how the blank-display-name case stops being
// reachable.
function fakeFieldValue(field: string, id: string): string {
  if (field === "displayName") {
    return displayNameById[id] ?? "";
  }
  if (field === "username") {
    return usernameById[id] || id;
  }
  return id;
}

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

describe("a departed member is not on the roster", () => {
  beforeEach(() => {
    requestedLimit = 0;
    lastRosterWhere = {};
    mockGetSession.mockClear();
  });

  test("the roster read filters on leftAt", async () => {
    // The reported bug: removing Bob from a den left his name sitting in the
    // roster while the header said the den held one person. His membership row is
    // still there - that is what preserves his history - so the only thing that
    // can take him off the list is the query asking for current members.
    rosterRows = [roster("owner", { role: "OWNER" }), roster("bob")];
    await getRoster("", "den-1");
    expect(lastRosterWhere["conversationId"]).toBe("den-1");
    expect(lastRosterWhere["leftAt:isNull"]).toBe(true);
  });
});

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
    lastRosterWhere = {};
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
    followingActorIds = ["admin", "user-2", "user-3", "user-4"];
    policyById = {};
    blockRows = [];
    blocksQueried = false;
    pendingBlocks = null;
    pendingFollows = null;
    pendingIdentities = null;
    pendingUsers = null;
    for (const id of Object.keys(displayNameById)) {
      displayNameById[id] = "";
    }
    for (const id of Object.keys(usernameById)) {
      usernameById[id] = "";
    }
    mockAddDenMembers.mockClear();
    mockAddDenMembers.mockImplementation(() => Promise.resolve(["user-3"]));
    mockRequireDenManager.mockClear();
    managerRefusal = null;
    mockFilterBannedUserIds.mockClear();
    mockFilterBannedUserIds.mockImplementation(() =>
      Promise.resolve(new Set<string>())
    );
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

  test("reports a member without Messages before the group-add policy", async () => {
    // Ordered that way on purpose: somebody who has not enabled Messages should
    // be told to enable Messages, not that they do not accept direct adds for an
    // account that could not read the den either way. The actionable message wins
    // over the merely true one.
    identityUserIds = ["admin", "user-2"];
    followingActorIds = ["admin", "user-2"];
    policyById = { "user-3": "NO_DIRECT_ADDS" };
    const res = await add({ memberIds: ["user-2", "user-3"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "NO_IDENTITY",
      error: "Some of those people haven't enabled Messages yet",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("refuses somebody who only lets people they follow add them", async () => {
    // The candidate's setting, asked of the CANDIDATE's own following list.
    // "user-3" is the account default and does not follow the caller, so it is
    // refused; "user-2" does follow the caller, so it is not. The pair in one
    // request is what proves the check is per candidate rather than about the
    // roster as a whole.
    followingActorIds = ["admin", "user-2"];
    policyById = { "user-3": "FOLLOWING_ONLY" };
    const res = await add({ memberIds: ["user-2", "user-3"] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "NOT_FOLLOWING_YOU",
      error: "Some of those people only let people they follow add them",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("refuses a candidate who allows no direct adds, even when they follow the caller", async () => {
    // Following them is not a way around it. If it were, the setting would only
    // stop people who did not already follow, which is the opposite of what
    // somebody turning it off is asking for.
    followingActorIds = ["admin", "user-3"];
    policyById = { "user-3": "NO_DIRECT_ADDS" };
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "NO_DIRECT_ADDS",
      error: "Some of those people don't allow being added to groups",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("admits a candidate who allows anybody, followed or not", async () => {
    // The setting the user asked for first. "user-3" does not follow the caller
    // and is still admitted, which is the whole point of EVERYONE and the reason
    // the old "you can only add people you follow" rule had to go.
    followingActorIds = ["admin", "user-2"];
    policyById = { "user-3": "EVERYONE" };
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: ["user-3"], ok: true });
    expect(mockAddDenMembers).toHaveBeenCalledWith("den-1", "admin", [
      "user-3",
    ]);
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

  // The banned pre-check, which exists so the refusal NAMES somebody instead of
  // handing back a generic failure for a batch. The load-bearing check is the one
  // inside `addDenMembers`, under its claim lock; this one only decides the wording.
  test("refuses a banned candidate by name, without adding anybody", async () => {
    displayNameById["user-3"] = "Ada Lovelace";
    usernameById["user-3"] = "ada";
    mockFilterBannedUserIds.mockImplementationOnce(() =>
      Promise.resolve(new Set(["user-3"]))
    );
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "BANNED",
      error:
        "Ada Lovelace is banned from this den. Unban them from the banned list first.",
    });
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("refuses a mixed batch for naming, and still adds nobody", async () => {
    // Naming only the banned one rather than listing all five: the manager needs to
    // know who to unban, not who else they had selected.
    displayNameById["user-3"] = "Ada Lovelace";
    usernameById["user-3"] = "ada";
    mockFilterBannedUserIds.mockImplementationOnce(() =>
      Promise.resolve(new Set(["user-3"]))
    );
    const res = await add({ memberIds: ["user-3", "user-4"] });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ada Lovelace");
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  // A ban is not a roster rule, so it must not leak past the group-add policy either:
  // somebody who also refuses direct adds is refused for THAT, which is a different
  // conversation with the candidate.
  test("checks the ban before the roster policy, so the ban is what is named", async () => {
    policyById = { "user-3": "NO_DIRECT_ADDS" };
    mockFilterBannedUserIds.mockImplementationOnce(() =>
      Promise.resolve(new Set(["user-3"]))
    );
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BANNED");
  });

  test("falls back to a username when the account has no display name", async () => {
    // " is banned from this den" is a broken sentence, and naming somebody is the
    // entire reason this pre-check exists.
    // An account with no display name at all, which is why the query falls back to the
    // username rather than to an empty string.
    usernameById["user-3"] = "ada";
    mockFilterBannedUserIds.mockImplementationOnce(() =>
      Promise.resolve(new Set(["user-3"]))
    );
    const res = await add({ memberIds: ["user-3"] });
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("ada is banned from this den");
  });

  // The ordering, pinned. The ban pre-check names the banned person and the naming reads
  // `Users.displayName` for caller-supplied ids, so running it before the authority gate
  // made it a per-id oracle over a manager-only list: anybody who could sign in could
  // POST an arbitrary user id and learn whether that person was banned from a den they
  // were not in, plus their display name. `addDenMembers` gates too, but it gates LAST.
  test("checks authority before the ban pre-check, which discloses", async () => {
    // The ban double is left at its permissive default on purpose. Queueing a ban here
    // would be self-defeating: the assertion is that the pre-check is never REACHED, so
    // a queued answer would sit unconsumed and hand the next test a banned user.
    managerRefusal = new DenError("FORBIDDEN", "Managers only");
    const res = await add({ memberIds: ["user-3"] });
    // The permission answer, not the ban answer.
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("FORBIDDEN");
    // And nothing was read about the ids the caller supplied.
    expect(mockFilterBannedUserIds).not.toHaveBeenCalled();
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("checks authority even when nobody is banned", async () => {
    // The control for the case above. Without it, a suite that simply never set a ban
    // would pass the ordering test for the wrong reason.
    managerRefusal = new DenError("FORBIDDEN", "Managers only");
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(403);
    expect(mockAddDenMembers).not.toHaveBeenCalled();
  });

  test("lets an unbanned batch through untouched", async () => {
    const res = await add({ memberIds: ["user-3"] });
    expect(res.status).toBe(201);
    // Checked with the whole requested set, so the helper can answer in one query.
    expect(mockFilterBannedUserIds).toHaveBeenCalledWith("den-1", ["user-3"]);
  });
});
