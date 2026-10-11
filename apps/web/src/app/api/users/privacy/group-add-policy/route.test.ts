import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET, PATCH } from "./route";

// The reader's own group-add setting.
//
// Two decisions worth pinning: a value the account does not have cannot be saved,
// and a save with no session is not a save. The second is not interesting on its
// own - it is every route in the app - but this one writes a privacy decision
// about who may reach an account, so the gate is asserted rather than assumed.

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user-1" } }));

let storedPolicy = "FOLLOWING_ONLY";
let existingUser = true;
let lastWrite: string | null = null;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  isGroupAddPolicy: (value: unknown) =>
    typeof value === "string" &&
    ["EVERYONE", "FOLLOWING_ONLY", "NO_DIRECT_ADDS"].includes(value),
  prisma: {
    orm: {
      public: {
        Users: {
          select: () => ({
            where: () => ({
              first: () =>
                existingUser ? { groupAddPolicy: storedPolicy } : null,
            }),
          }),
          where: () => ({
            update: ({ groupAddPolicy }: { groupAddPolicy: string }) => {
              lastWrite = groupAddPolicy;
              // Absent rather than falsy, so the null branch is reachable: a
              // session can outlive the account it names.
              return existingUser
                ? { groupAddPolicy }
                : (null as unknown as { groupAddPolicy: string });
            },
          }),
        },
      },
    },
  },
}));

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost:3000/api/users/privacy/group-add-policy", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    })
  );
}

beforeEach(() => {
  // Reset rather than clear: a test that signs the reader out does it with an
  // implementation, and `mockClear` leaves that in place - so every later test
  // would be answering 401 for a reason that has nothing to do with what it is
  // testing.
  mockGetSession.mockReset();
  mockGetSession.mockImplementation(() => ({ user: { id: "user-1" } }));
  storedPolicy = "FOLLOWING_ONLY";
  existingUser = true;
  lastWrite = null;
});

describe("GET /api/users/privacy/group-add-policy", () => {
  test("answers with the reader's own setting", async () => {
    storedPolicy = "NO_DIRECT_ADDS";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      groupAddPolicy: "NO_DIRECT_ADDS",
    });
  });

  test("refuses a signed-out reader", async () => {
    mockGetSession.mockImplementation(() => null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  test("reports a missing account rather than a default", async () => {
    // A stale session must not be answered with somebody else's default, which
    // would tell the reader their setting is FOLLOWING_ONLY when there is no
    // account to hold it.
    existingUser = false;
    const response = await GET();
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/users/privacy/group-add-policy", () => {
  test("saves each declared policy", async () => {
    const policies = ["EVERYONE", "FOLLOWING_ONLY", "NO_DIRECT_ADDS"] as const;
    const responses = await Promise.all(
      policies.map((groupAddPolicy) => patch({ groupAddPolicy }))
    );
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    );
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(bodies).toEqual(
      policies.map((groupAddPolicy) => ({ groupAddPolicy, ok: true }))
    );
    expect(lastWrite).toBe("NO_DIRECT_ADDS");
  });

  test("refuses a value the account does not have", async () => {
    // The list of accepted values exists once, in @asm/db. A route that spelled
    // its own would be the second copy, and the copy that rots.
    const refused = await Promise.all(
      ["followers_only", "", 1, null, undefined].map((groupAddPolicy) =>
        patch({ groupAddPolicy })
      )
    );
    expect(refused.map((response) => response.status)).toEqual([
      400, 400, 400, 400, 400,
    ]);
    expect(lastWrite).toBeNull();
  });

  test("refuses a body that is not an object with the field", async () => {
    const notJson = await patch("not json");
    const empty = await patch({});
    const wrongType = await patch({ groupAddPolicy: 7 });
    expect([notJson.status, empty.status, wrongType.status]).toEqual([
      400, 400, 400,
    ]);
  });

  test("ignores fields it does not know rather than refusing the save", async () => {
    // The schema strips unknown keys, so a client from a newer build that sends
    // an extra field still gets its setting saved. Refusing would mean an
    // unrelated addition could stop somebody changing a privacy setting.
    const response = await patch({ extra: true, groupAddPolicy: "EVERYONE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      groupAddPolicy: "EVERYONE",
      ok: true,
    });
    expect(lastWrite).toBe("EVERYONE");
  });

  test("refuses a signed-out writer", async () => {
    mockGetSession.mockImplementation(() => null);
    const response = await patch({ groupAddPolicy: "EVERYONE" });
    expect(response.status).toBe(401);
    expect(lastWrite).toBeNull();
  });

  test("reports a missing account rather than claiming the save landed", async () => {
    existingUser = false;
    const response = await patch({ groupAddPolicy: "EVERYONE" });
    expect(response.status).toBe(404);
  });
});
