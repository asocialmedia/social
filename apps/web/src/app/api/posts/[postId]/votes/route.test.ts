import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const VOTER_ID = "voter1";

interface VoteRow {
  value: number;
}

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: VOTER_ID },
}));

const state = {
  postAura: 0,
  userAura: 0,
  existingVote: null as VoteRow | null,
  auraLogs: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
};

function resetState() {
  state.postAura = 0;
  state.userAura = 0;
  state.existingVote = null;
  state.auraLogs = [];
  state.notifications = [];
}

const mockTx = {
  post: {
    findUnique: (args: {
      include?: unknown;
      select?: unknown;
      where: { id: string };
    }) => {
      if (args.where.id !== POST_ID) {
        return null;
      }
      if (args.include) {
        return {
          id: POST_ID,
          userId: AUTHOR_ID,
          aura: state.postAura,
          vote: state.existingVote
            ? [{ userId: VOTER_ID, value: state.existingVote.value }]
            : [],
        };
      }
      return { id: POST_ID, userId: AUTHOR_ID };
    },
    update: (args: {
      data: { aura?: { decrement?: number; increment?: number } };
    }) => {
      state.postAura += args.data.aura?.increment ?? 0;
      state.postAura -= args.data.aura?.decrement ?? 0;
    },
  },
  user: {
    update: (args: {
      data: { aura?: { decrement?: number; increment?: number } };
    }) => {
      state.userAura += args.data.aura?.increment ?? 0;
      state.userAura -= args.data.aura?.decrement ?? 0;
    },
  },
  vote: {
    delete: () => {
      state.existingVote = null;
    },
    findUnique: (_args: {
      where: { userId_postId: { postId: string; userId: string } };
    }): VoteRow | null => state.existingVote,
    upsert: (args: {
      create: { value: number };
      update: { value: number };
    }) => {
      state.existingVote = { value: args.create.value };
    },
  },
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
  },
  notification: {
    create: (args: { data: Record<string, unknown> }) => {
      state.notifications.push(args.data);
    },
    deleteMany: (args: {
      where: {
        issuerId: string;
        postId: string;
        recipientId: string;
        type: string;
      };
    }) => {
      const { issuerId, postId, recipientId, type } = args.where;
      state.notifications = state.notifications.filter(
        (notification) =>
          !(
            notification.type === type &&
            notification.recipientId === recipientId &&
            notification.issuerId === issuerId &&
            notification.postId === postId
          )
      );
    },
  },
};

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  post: mockTx.post,
  vote: mockTx.vote,
};

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true, vote: true }),
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

import { DELETE, GET, POST } from "./route";

function postRequest(value: number): Request {
  return new Request(`http://localhost/api/posts/${POST_ID}/votes`, {
    body: JSON.stringify({ value }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

const context = { params: Promise.resolve({ postId: POST_ID }) };

describe("POST /api/posts/[postId]/votes", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await POST(postRequest(1), context);

    expect(res.status).toBe(401);
    expect(state.postAura).toBe(0);
    expect(state.userAura).toBe(0);
  });

  test("rejects invalid vote values", async () => {
    const res = await POST(postRequest(5), context);

    expect(res.status).toBe(400);
    expect(state.postAura).toBe(0);
    expect(state.userAura).toBe(0);
  });

  test("returns 404 when the post does not exist", async () => {
    const missingContext = {
      params: Promise.resolve({ postId: "missing" }),
    };
    const res = await POST(postRequest(1), missingContext);

    expect(res.status).toBe(404);
  });

  test("amplifying your own post records the vote but awards no aura", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: AUTHOR_ID } });

    const res = await POST(postRequest(1), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 0, userVote: 1 });
    expect(state.postAura).toBe(0);
    expect(state.userAura).toBe(0);
    expect(state.auraLogs).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  test("amplifying credits aura to the post and its author", async () => {
    const res = await POST(postRequest(1), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 1, userVote: 1 });
    expect(state.postAura).toBe(1);
    expect(state.userAura).toBe(1);
    expect(state.auraLogs).toEqual([
      {
        userId: AUTHOR_ID,
        issuerId: VOTER_ID,
        amount: 1,
        type: "POST_VOTE",
        postId: POST_ID,
      },
    ]);
    expect(state.notifications).toEqual([
      {
        type: "AMPLIFY",
        recipientId: AUTHOR_ID,
        issuerId: VOTER_ID,
        postId: POST_ID,
      },
    ]);
  });

  test("changing an amplify into a mute applies the full delta", async () => {
    state.existingVote = { value: 1 };
    state.postAura = 1;
    state.userAura = 1;
    state.notifications.push({
      type: "AMPLIFY",
      recipientId: AUTHOR_ID,
      issuerId: VOTER_ID,
      postId: POST_ID,
    });

    const res = await POST(postRequest(-1), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: -1, userVote: -1 });
    expect(state.postAura).toBe(-1);
    expect(state.userAura).toBe(-1);
    expect(state.auraLogs).toEqual([
      {
        userId: AUTHOR_ID,
        issuerId: VOTER_ID,
        amount: -2,
        type: "POST_VOTE_REMOVED",
        postId: POST_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("setting a vote to 0 removes aura and the amplify notification", async () => {
    state.existingVote = { value: 1 };
    state.postAura = 1;
    state.userAura = 1;
    state.notifications.push({
      type: "AMPLIFY",
      recipientId: AUTHOR_ID,
      issuerId: VOTER_ID,
      postId: POST_ID,
    });

    const res = await POST(postRequest(0), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 0, userVote: 0 });
    expect(state.postAura).toBe(0);
    expect(state.userAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        userId: AUTHOR_ID,
        issuerId: VOTER_ID,
        amount: -1,
        type: "POST_VOTE_REMOVED",
        postId: POST_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });
});

describe("DELETE /api/posts/[postId]/votes", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("removing an amplify revokes aura from the post and its author", async () => {
    state.existingVote = { value: 1 };
    state.postAura = 1;
    state.userAura = 1;
    state.notifications.push({
      type: "AMPLIFY",
      recipientId: AUTHOR_ID,
      issuerId: VOTER_ID,
      postId: POST_ID,
    });

    const res = await DELETE(
      new Request(`http://localhost/api/posts/${POST_ID}/votes`),
      context
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 0, userVote: 0 });
    expect(state.postAura).toBe(0);
    expect(state.userAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        userId: AUTHOR_ID,
        issuerId: VOTER_ID,
        amount: -1,
        type: "POST_VOTE_REMOVED",
        postId: POST_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("deleting without an existing vote changes nothing", async () => {
    const res = await DELETE(
      new Request(`http://localhost/api/posts/${POST_ID}/votes`),
      context
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 0, userVote: 0 });
    expect(state.postAura).toBe(0);
    expect(state.userAura).toBe(0);
    expect(state.auraLogs).toEqual([]);
  });
});

describe("GET /api/posts/[postId]/votes", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("returns the post aura and the user's current vote", async () => {
    state.postAura = 3;
    state.existingVote = { value: 1 };

    const res = await GET(
      new Request(`http://localhost/api/posts/${POST_ID}/votes`),
      context
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aura).toBe(3);
    expect(body.userVote).toBe(1);
  });
});
