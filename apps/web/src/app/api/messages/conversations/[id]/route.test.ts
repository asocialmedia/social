import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user-1" } }));

// The read gate's answer. The route attaches each member's presence windows to
// this payload, computed from the membership log.
let conversation: {
  members: {
    createdAt: Date;
    leftAt: Date | null;
    userId: string;
  }[];
  type: "DM" | "DEN";
} | null;

// The membership log, and the cutoff it was asked with: a departed reader's log
// stops at their own departure, and the windows must be built from nothing past
// it.
let visibleUntilSeen: Date | null | "unset" = "unset";
const LOG = [
  {
    action: "JOINED",
    actorId: "user-2",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    targetUserId: null,
  },
  {
    action: "LEFT",
    actorId: "user-2",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    targetUserId: null,
  },
  {
    action: "JOINED",
    actorId: "user-2",
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    targetUserId: null,
  },
];

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: () => Promise.resolve(conversation),
}));

mock.module("@asm/db", () => ({
  fromPrismaDateTime: (value: Date): Date => value,
  listDenMembershipEvents: (_id: string, visibleUntil: Date | null) => {
    visibleUntilSeen = visibleUntil;
    return Promise.resolve(LOG);
  },
  prisma: {
    orm: {
      public: {
        MessageConversationKeys: {
          select: () => ({ where: () => ({ all: () => Promise.resolve([]) }) }),
        },
        Messages: {
          where: () => ({
            aggregate: (fn: (value: { count: () => number }) => unknown) =>
              fn({ count: () => 0 }),
          }),
        },
      },
    },
  },
}));

function get(id = "den-1"): Promise<Response> {
  return GET(new Request(`http://test/api/messages/conversations/${id}`), {
    params: Promise.resolve({ id }),
  });
}

interface WindowWire {
  after: string | null;
  before: string | null;
}

beforeEach(() => {
  mockGetSession.mockImplementation(() => ({ user: { id: "user-1" } }));
  visibleUntilSeen = "unset";
  conversation = {
    members: [
      {
        createdAt: new Date("2025-12-01T00:00:00.000Z"),
        leftAt: null,
        userId: "user-1",
      },
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        leftAt: null,
        userId: "user-2",
      },
    ],
    type: "DEN",
  };
});

describe("GET /api/messages/conversations/:id", () => {
  test("401s without a session", async () => {
    mockGetSession.mockImplementation(() => null);
    const response = await get();
    expect(response.status).toBe(401);
  });

  test("404s when the read gate refuses the conversation", async () => {
    conversation = null;
    const response = await get();
    expect(response.status).toBe(404);
  });

  test("attaches each den member's presence windows, one per stint", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversation: {
        members: { membershipWindows?: WindowWire[]; userId: string }[];
      };
    };
    const byId = new Map(
      body.conversation.members.map((member) => [member.userId, member])
    );
    // user-2 left and came back: two bounded stints, and the gap between them is
    // no window at all. This is the payload the client's heal gate reads before
    // it decides whether a missed epoch may be handed to them.
    expect(byId.get("user-2")?.membershipWindows).toEqual([
      {
        after: "2026-01-01T00:00:00.000Z",
        before: "2026-02-01T00:00:00.000Z",
      },
      { after: "2026-03-01T00:00:00.000Z", before: null },
    ]);
    // user-1 has no log lines: the single row window, from the row's own join.
    expect(byId.get("user-1")?.membershipWindows).toEqual([
      { after: "2025-12-01T00:00:00.000Z", before: null },
    ]);
  });

  test("builds windows from a log capped at the reader's own departure", async () => {
    const leftAt = new Date("2026-02-15T00:00:00.000Z");
    conversation = {
      members: [
        {
          createdAt: new Date("2025-12-01T00:00:00.000Z"),
          leftAt,
          userId: "user-1",
        },
      ],
      type: "DEN",
    };
    const response = await get();
    expect(response.status).toBe(200);
    // Everything past the reader's own `leftAt` is about a room they are no
    // longer in - the same cutoff the transcript's events route applies.
    expect(visibleUntilSeen).toBe(leftAt);
  });

  test("a current reader's log is uncapped", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(visibleUntilSeen).toBeNull();
  });

  test("a DM carries no windows and reads no log", async () => {
    conversation = {
      members: [
        {
          createdAt: new Date("2025-12-01T00:00:00.000Z"),
          leftAt: null,
          userId: "user-1",
        },
      ],
      type: "DM",
    };
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversation: {
        members: { membershipWindows?: WindowWire[]; userId: string }[];
      };
    };
    // A DM roster never moves, so there is nothing to window - and the key is
    // absent rather than null, matching what a cached pre-windows payload holds.
    expect(body.conversation.members[0]?.membershipWindows).toBeUndefined();
    expect(visibleUntilSeen).toBe("unset");
  });
});
