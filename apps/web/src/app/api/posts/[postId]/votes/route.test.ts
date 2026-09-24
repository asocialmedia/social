import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DELETE, GET, POST } from "./route";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const VOTER_ID = "voter1";

interface VoteRow {
  awardedAura: number;
  mutingCostAura: number;
  value: number;
}

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: VOTER_ID },
}));

const state = {
  auraLogs: [] as Record<string, unknown>[],
  existingVote: null as VoteRow | null,
  notifications: [] as Record<string, unknown>[],
  postAura: 0,
  userAura: {} as Record<string, number>,
};

function resetState() {
  state.postAura = 0;
  state.userAura = {};
  state.existingVote = null;
  state.auraLogs = [];
  state.notifications = [];
}

function addAura(userId: string, delta: number) {
  state.userAura[userId] = (state.userAura[userId] ?? 0) + delta;
}

// Faithful transition decomposition (identical semantics to engine.ts): the
// routes depend on its ORDER (removals settle before applications), so the
// mock reproduces it rather than stubbing it.
function decompose(oldValue: number, newValue: number): string[] {
  const components: string[] = [];
  if (oldValue === 1 && newValue !== 1) {
    components.push("REMOVE_AMPLIFY");
  }
  if (oldValue === -1 && newValue !== -1) {
    components.push("REMOVE_MUTE");
  }
  if (newValue === 1 && oldValue !== 1) {
    components.push("APPLY_AMPLIFY");
  }
  if (newValue === -1 && oldValue !== -1) {
    components.push("APPLY_MUTE");
  }
  return components;
}

const mockTx = {
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
  },
  notification: {
    create: (args: { data: Record<string, unknown> }) => {
      state.notifications.push(args.data);
      // The route hands the created row's id to the notification queue.
      return { id: `notif-${state.notifications.length}`, ...args.data };
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
          aura: state.postAura,
          id: POST_ID,
          userId: AUTHOR_ID,
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
      return Promise.resolve({});
    },
  },
  user: {
    findUnique: () =>
      // The voter is a maximally credible veteran, so weighted awards land at
      // full base price in these tests.
      Promise.resolve({ aura: 12_000, createdAt: new Date(0) }),
    update: (args: {
      data: { aura?: { decrement?: number; increment?: number } };
      where: { id: string };
    }) => {
      const delta =
        (args.data.aura?.increment ?? 0) - (args.data.aura?.decrement ?? 0);
      addAura(args.where.id, delta);
      return Promise.resolve({});
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
      create: { awardedAura: number; mutingCostAura: number; value: number };
      update: { awardedAura: number; mutingCostAura: number; value: number };
    }) => {
      state.existingVote = {
        awardedAura: args.update.awardedAura,
        mutingCostAura: args.update.mutingCostAura,
        value: args.update.value,
      };
    },
  },
};

const mockOrm = {
  public: {
    Notifications: {
      select: () => ({
        create: (data: Record<string, unknown>) => {
          state.notifications.push(data);
          return Promise.resolve({ id: "notification-1", ...data });
        },
      }),
      where: () => ({
        delete: () => {
          state.notifications = [];
          return Promise.resolve();
        },
      }),
    },
    Posts: {
      select: () => ({
        where: (filter: { id?: string }) => ({
          first: () =>
            Promise.resolve(
              filter.id === POST_ID
                ? { aura: state.postAura, id: POST_ID, userId: AUTHOR_ID }
                : null
            ),
        }),
      }),
      where: () => ({
        updateAndCount: (data: { aura: number }) => {
          state.postAura = data.aura;
          return Promise.resolve(1);
        },
      }),
    },
    Users: {
      select: () => ({
        where: () => ({
          first: () =>
            Promise.resolve({ aura: 12_000, createdAt: new Date(0) }),
        }),
      }),
    },
    Votes: {
      create: (data: VoteRow) => {
        state.existingVote = {
          awardedAura: data.awardedAura,
          mutingCostAura: data.mutingCostAura,
          value: data.value,
        };
        return Promise.resolve(data);
      },
      where: () => ({
        deleteAndCount: () => {
          state.existingVote = null;
          return Promise.resolve(1);
        },
        first: () => Promise.resolve(state.existingVote),
        updateAndCount: (data: VoteRow) => {
          state.existingVote = {
            awardedAura: data.awardedAura,
            mutingCostAura: data.mutingCostAura,
            value: data.value,
          };
          return Promise.resolve(1);
        },
      }),
    },
  },
};

// Mock ledger helpers mirroring the real contracts narrowly: a maximally
// credible voter pays full price (amplify +3 / mute -3 / muting cost -1),
// self-engagement zeroes, removals reverse exactly. The math itself is
// covered by packages/db/src/aura/*.test.ts.
const mockDb = () => ({
  AMPLIFY_RECEIVE_AURA: 3,
  MUTE_RECEIVE_AURA: 3,
  and: (...conditions: unknown[]) => conditions,
  applyWeightedAward: (
    tx: typeof mockTx,
    args: {
      actorId: string;
      baseAmount: number;
      now: Date;
      postId: string;
      recipientId: string;
      type: string;
    }
  ) => {
    if (args.actorId === args.recipientId) {
      return Promise.resolve({ amount: 0 });
    }
    tx.user.update({
      data: { aura: { increment: args.baseAmount } },
      where: { id: args.recipientId },
    });
    tx.auraLog.create({
      data: {
        amount: args.baseAmount,
        issuerId: args.actorId,
        postId: args.postId,
        targetUserId: args.recipientId,
        type: args.type,
        userId: args.recipientId,
      },
    });
    return Promise.resolve({ amount: args.baseAmount });
  },
  chargeMutingCost: (
    tx: typeof mockTx,
    args: { muterId: string; postId: string }
  ) => {
    tx.user.update({
      data: { aura: { increment: -1 } },
      where: { id: args.muterId },
    });
    tx.auraLog.create({
      data: {
        amount: -1,
        issuerId: args.muterId,
        postId: args.postId,
        targetUserId: args.muterId,
        type: "MUTING_COST",
        userId: args.muterId,
      },
    });
    return Promise.resolve({ amount: -1 });
  },
  decomposeVoteTransition: (
    oldValue: number,
    newValue: number
  ): { kind: string }[] =>
    decompose(oldValue, newValue).map((kind) => ({ kind })),
  fromPrismaDateTime: (value: Date) => value,
  getPostDataInclude: () => ({ user: true, vote: true }),
  getPostDataQuery: () => ({
    where: () => ({
      first: () =>
        Promise.resolve({
          aura: state.postAura,
          id: POST_ID,
          userId: AUTHOR_ID,
          vote: state.existingVote
            ? [{ userId: VOTER_ID, value: state.existingVote.value }]
            : [],
        }),
    }),
  }),
  invalidateAuraSignals: () => Promise.resolve(),
  invalidateFypProfile: () => Promise.resolve(),
  mapPostData: (value: Record<string, unknown>) => value,
  prisma: mockPrisma,
  reverseExactAura: (
    tx: typeof mockTx,
    args: {
      issuerId: string;
      openAmount: number;
      postId: string;
      recipientId: string;
      type: string;
    }
  ) => {
    if (args.openAmount === 0) {
      return Promise.resolve({ amount: 0 });
    }
    const reversed = -args.openAmount;
    tx.user.update({
      data: { aura: { increment: reversed } },
      where: { id: args.recipientId },
    });
    tx.auraLog.create({
      data: {
        amount: reversed,
        issuerId: args.issuerId,
        postId: args.postId,
        targetUserId: args.recipientId,
        type: args.type,
        userId: args.recipientId,
      },
    });
    return Promise.resolve({ amount: reversed });
  },
  settleVoteTransition: (
    tx: typeof mockTx,
    args: {
      actorId: string;
      newValue: number;
      oldValue: number;
      postId: string;
      positions: { awardedAura: number; mutingCostAura: number };
      recipientId: string;
      types: {
        amplifyApplied: string;
        amplifyRemoved: string;
      };
    }
  ) => {
    let { awardedAura } = args.positions;
    let { mutingCostAura } = args.positions;
    const apply = (amount: number, recipientId: string, type: string) => {
      if (amount === 0) {
        return;
      }
      tx.user.update({
        data: { aura: { increment: amount } },
        where: { id: recipientId },
      });
      tx.auraLog.create({
        data: {
          amount,
          issuerId: args.actorId,
          postId: args.postId,
          targetUserId: recipientId,
          type,
          userId: recipientId,
        },
      });
    };
    if (args.oldValue === 1 && args.newValue !== 1) {
      apply(-awardedAura, args.recipientId, args.types.amplifyRemoved);
      awardedAura = 0;
    }
    if (args.oldValue === -1 && args.newValue !== -1) {
      apply(-awardedAura, args.recipientId, args.types.amplifyApplied);
      awardedAura = 0;
      if (mutingCostAura !== 0) {
        apply(-mutingCostAura, args.actorId, "MUTING_COST");
        mutingCostAura = 0;
      }
    }
    if (args.newValue === 1 && args.oldValue !== 1) {
      const amount = args.actorId === args.recipientId ? 0 : 3;
      apply(amount, args.recipientId, args.types.amplifyApplied);
      awardedAura += amount;
    }
    if (args.newValue === -1 && args.oldValue !== -1) {
      const amount = args.actorId === args.recipientId ? 0 : -3;
      apply(amount, args.recipientId, args.types.amplifyRemoved);
      awardedAura += amount;
      apply(-1, args.actorId, "MUTING_COST");
      mutingCostAura -= 1;
    }
    return Promise.resolve({ awardedAura, mutingCostAura });
  },
});

const mockPrisma = {
  orm: mockOrm,
  post: mockTx.post,
  transaction: (
    fn: (tx: typeof mockTx & { orm: typeof mockOrm }) => Promise<unknown>
  ) => fn({ ...mockTx, orm: mockOrm }),
  user: mockTx.user,
  vote: mockTx.vote,
};

mock.module("@asm/db", () => mockDb());

mock.module("@/lib/recommendations/record-event", () => ({
  recordRecommendationInteraction: () => Promise.resolve(),
}));

mock.module("@/lib/users/suggested-users-cache", () => ({
  suggestedUsersCache: { invalidateForUser: () => Promise.resolve() },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

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
  });

  test("rejects invalid vote values", async () => {
    const res = await POST(postRequest(5), context);

    expect(res.status).toBe(400);
    expect(state.postAura).toBe(0);
  });

  test("returns 404 when the post does not exist", async () => {
    const missingContext = {
      params: Promise.resolve({ postId: "missing" }),
    };
    const res = await POST(postRequest(1), missingContext);

    expect(res.status).toBe(404);
  });

  test("amplifying your own post moves the raw score but awards no aura", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: AUTHOR_ID } });

    const res = await POST(postRequest(1), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 1, userVote: 1 });
    expect(state.postAura).toBe(1);
    expect(state.userAura[AUTHOR_ID]).toBeUndefined();
    expect(state.auraLogs).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  test("amplifying credits the raw score and a weighted author award", async () => {
    const res = await POST(postRequest(1), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 1, userVote: 1 });
    // Raw +-1 on the post; full-price (+3) weighted award for the author.
    expect(state.postAura).toBe(1);
    expect(state.userAura[AUTHOR_ID]).toBe(3);
    expect(state.existingVote).toEqual({
      awardedAura: 3,
      mutingCostAura: 0,
      value: 1,
    });
    expect(state.auraLogs).toEqual([
      {
        amount: 3,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_VOTE",
        userId: AUTHOR_ID,
      },
    ]);
    expect(state.notifications).toEqual([
      {
        _type: "AMPLIFY",
        issuerId: VOTER_ID,
        postId: POST_ID,
        recipientId: AUTHOR_ID,
      },
    ]);
  });

  test("changing an amplify into a mute reverses the gain, applies the loss, charges the muter", async () => {
    state.existingVote = {
      awardedAura: 3,
      mutingCostAura: 0,
      value: 1,
    };
    state.postAura = 1;
    state.userAura[AUTHOR_ID] = 3;
    state.notifications.push({
      issuerId: VOTER_ID,
      postId: POST_ID,
      recipientId: AUTHOR_ID,
      type: "AMPLIFY",
    });

    const res = await POST(postRequest(-1), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: -1, userVote: -1 });
    expect(state.postAura).toBe(-1);
    // Author: +3 standing refunded, then -3 mute loss applied.
    expect(state.userAura[AUTHOR_ID]).toBe(-3);
    // Muter pays the honesty cost.
    expect(state.userAura[VOTER_ID]).toBe(-1);
    expect(state.existingVote).toEqual({
      awardedAura: -3,
      mutingCostAura: -1,
      value: -1,
    });
    expect(state.auraLogs).toEqual([
      {
        amount: -3,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_VOTE_REMOVED",
        userId: AUTHOR_ID,
      },
      {
        amount: -3,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_VOTE_REMOVED",
        userId: AUTHOR_ID,
      },
      {
        amount: -1,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: VOTER_ID,
        type: "MUTING_COST",
        userId: VOTER_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("setting a vote to 0 removes the raw score and reverses the award exactly", async () => {
    state.existingVote = {
      awardedAura: 3,
      mutingCostAura: 0,
      value: 1,
    };
    state.postAura = 1;
    state.userAura[AUTHOR_ID] = 3;
    state.notifications.push({
      issuerId: VOTER_ID,
      postId: POST_ID,
      recipientId: AUTHOR_ID,
      type: "AMPLIFY",
    });

    const res = await POST(postRequest(0), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 0, userVote: 0 });
    expect(state.postAura).toBe(0);
    expect(state.userAura[AUTHOR_ID]).toBe(0);
    expect(state.existingVote).toBeNull();
    expect(state.auraLogs).toEqual([
      {
        amount: -3,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_VOTE_REMOVED",
        userId: AUTHOR_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("a legacy vote with zero stored positions reverses no aura", async () => {
    // Votes placed before the economy shipped carry zero open positions:
    // un-voting updates the raw score but never re-charges history.
    state.existingVote = {
      awardedAura: 0,
      mutingCostAura: 0,
      value: 1,
    };
    state.postAura = 1;
    state.userAura[AUTHOR_ID] = 1;

    const res = await POST(postRequest(0), context);

    expect(res.status).toBe(200);
    expect(state.postAura).toBe(0);
    expect(state.userAura[AUTHOR_ID]).toBe(1);
    expect(state.auraLogs).toEqual([]);
  });
});

describe("DELETE /api/posts/[postId]/votes", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("removing an amplify revokes the raw score and the award", async () => {
    state.existingVote = {
      awardedAura: 3,
      mutingCostAura: 0,
      value: 1,
    };
    state.postAura = 1;
    state.userAura[AUTHOR_ID] = 3;
    state.notifications.push({
      issuerId: VOTER_ID,
      postId: POST_ID,
      recipientId: AUTHOR_ID,
      type: "AMPLIFY",
    });

    const res = await DELETE(
      new Request(`http://localhost/api/posts/${POST_ID}/votes`),
      context
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ aura: 0, userVote: 0 });
    expect(state.postAura).toBe(0);
    expect(state.userAura[AUTHOR_ID]).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        amount: -3,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_VOTE_REMOVED",
        userId: AUTHOR_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("removing a mute refunds both the author loss and the muter cost", async () => {
    state.existingVote = {
      awardedAura: -3,
      mutingCostAura: -1,
      value: -1,
    };
    state.postAura = -1;
    state.userAura[AUTHOR_ID] = -3;
    state.userAura[VOTER_ID] = -1;

    const res = await DELETE(
      new Request(`http://localhost/api/posts/${POST_ID}/votes`),
      context
    );

    expect(res.status).toBe(200);
    expect(state.postAura).toBe(0);
    expect(state.userAura[AUTHOR_ID]).toBe(0);
    expect(state.userAura[VOTER_ID]).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        amount: 3,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_VOTE",
        userId: AUTHOR_ID,
      },
      {
        amount: 1,
        issuerId: VOTER_ID,
        postId: POST_ID,
        targetUserId: VOTER_ID,
        type: "MUTING_COST",
        userId: VOTER_ID,
      },
    ]);
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
    expect(state.userAura).toEqual({});
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
    state.existingVote = {
      awardedAura: 3,
      mutingCostAura: 0,
      value: 1,
    };

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
