import { describe, expect, test } from "bun:test";

import {
  AMPLIFY_RECEIVE_AURA,
  MUTE_RECEIVE_AURA,
  MUTING_COST_AURA,
} from "./config";
import {
  applyFlatAward,
  applyModerationPenalty,
  applyWeightedAward,
  chargeMutingCost,
  reverseExactAura,
} from "./ledger";

// Hand-built fake transaction client: captures balance updates and ledger
// rows so the writer's behavior is verified without a database. Mirrors the
// mock style used across the repo's route tests.
function createFakeTx(
  options: {
    priorInteractions?: number;
    incomeToday?: number;
    accountAgeDays?: number;
    lifetimeAura?: number;
  } = {}
) {
  const state = {
    aggregateQueries: [] as Record<string, unknown>[],
    balanceUpdates: [] as { id: string; increment: number }[],
    countQueries: [] as Record<string, unknown>[],
    ledgerRows: [] as Record<string, unknown>[],
  };

  const tx = {
    auraLog: {
      // Promise-returning shapes match AuraLedgerTx without async arrows
      // (which the linter strips).
      aggregate: (args: { where: Record<string, unknown> }) => {
        state.aggregateQueries.push(args.where);
        return Promise.resolve({ _sum: { amount: options.incomeToday ?? 0 } });
      },
      count: (args: { where: Record<string, unknown> }) => {
        state.countQueries.push(args.where);
        return Promise.resolve(options.priorInteractions ?? 0);
      },
      create: (args: { data: Record<string, unknown> }) => {
        state.ledgerRows.push(args.data);
        return Promise.resolve({});
      },
    },
    user: {
      update: (args: {
        data: { aura: { increment: number } };
        where: { id: string };
      }) => {
        state.balanceUpdates.push({
          id: args.where.id,
          increment: args.data.aura.increment,
        });
        return Promise.resolve({});
      },
    },
  };

  const now = new Date("2026-08-24T12:00:00Z");
  const actor = {
    aura: options.lifetimeAura ?? 10_000,
    createdAt: new Date(
      now.getTime() - (options.accountAgeDays ?? 90) * 86_400_000
    ),
  };

  return { actor, now, state, tx };
}

const RECIPIENT = "user-recipient";
const ACTOR_ID = "user-actor";

describe("applyWeightedAward", () => {
  test("full-price award from a maximally credible actor", async () => {
    const { tx, now, actor, state } = createFakeTx();

    const result = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      baseAmount: AMPLIFY_RECEIVE_AURA,
      now,
      postId: "post-1",
      recipientId: RECIPIENT,
      subjectToDailyCap: true,
      taperClass: "amplify",
      type: "POST_VOTE",
    });

    expect(result.amount).toBe(AMPLIFY_RECEIVE_AURA);
    expect(state.balanceUpdates).toEqual([
      { id: RECIPIENT, increment: AMPLIFY_RECEIVE_AURA },
    ]);
    expect(state.ledgerRows).toHaveLength(1);
    expect(state.ledgerRows[0]).toMatchObject({
      amount: AMPLIFY_RECEIVE_AURA,
      issuerId: ACTOR_ID,
      postId: "post-1",
      targetUserId: RECIPIENT,
      type: "POST_VOTE",
      userId: RECIPIENT,
    });
  });

  test("zero awards write nothing - there is no point to trace", async () => {
    const { tx, now, actor, state } = createFakeTx({
      accountAgeDays: 0,
      lifetimeAura: 0,
    });

    const result = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      baseAmount: AMPLIFY_RECEIVE_AURA,
      now,
      postId: "post-1",
      recipientId: RECIPIENT,
      type: "POST_VOTE",
    });

    expect(result.amount).toBe(0);
    expect(state.balanceUpdates).toHaveLength(0);
    expect(state.ledgerRows).toHaveLength(0);
  });

  test("self-engagement earns nothing unless explicitly allowed", async () => {
    const { tx, now, actor, state } = createFakeTx();

    const blocked = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      baseAmount: AMPLIFY_RECEIVE_AURA,
      now,
      postId: "post-1",
      recipientId: ACTOR_ID,
      type: "POST_VOTE",
    });
    expect(blocked.amount).toBe(0);
    expect(state.balanceUpdates).toHaveLength(0);
    expect(state.ledgerRows).toHaveLength(0);

    const allowed = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      allowSelfAward: true,
      baseAmount: 4,
      now,
      postId: "post-1",
      recipientId: ACTOR_ID,
      type: "POST_BOOKMARK_RECEIVED",
    });
    expect(allowed.amount).toBeGreaterThan(0);
    expect(state.ledgerRows).toHaveLength(1);
  });

  test("taper counts prior pair interactions inside the window", async () => {
    const { tx, now, actor, state } = createFakeTx({ priorInteractions: 2 });

    const result = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      baseAmount: AMPLIFY_RECEIVE_AURA,
      now,
      recipientId: RECIPIENT,
      taperClass: "amplify",
      type: "POST_VOTE",
    });

    expect(state.countQueries).toHaveLength(1);
    const where = state.countQueries[0] as Record<string, unknown>;
    expect(where).toMatchObject({
      amount: { gt: 0 },
      issuerId: ACTOR_ID,
      targetUserId: RECIPIENT,
    });
    // Window is PAIR_TAPER_WINDOW_DAYS wide ending at `now`.
    const windowStart = (where.createdAt as { gte: Date }).gte;
    expect(now.getTime() - windowStart.getTime()).toBe(30 * 86_400_000);

    // floor(3 * 1.0 * 0.6)
    expect(result.amount).toBe(1);
  });

  test("daily cap reads positive non-milestone income since UTC midnight", async () => {
    const { tx, now, actor, state } = createFakeTx({ incomeToday: 240 });

    const result = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      baseAmount: 2,
      now,
      recipientId: RECIPIENT,
      subjectToDailyCap: true,
      type: "COMMENT_RECEIVED",
    });

    expect(state.aggregateQueries).toHaveLength(1);
    const where = state.aggregateQueries[0] as Record<string, unknown>;
    expect(where).toMatchObject({
      amount: { gt: 0 },
      type: {
        notIn: [
          "POST_VIEWS_MILESTONE",
          "SHARE_MILESTONE",
          "TRENDING_APPEARANCE",
        ],
      },
      userId: RECIPIENT,
    });
    const dayStart = (where.createdAt as { gte: Date }).gte;
    expect(dayStart.toISOString()).toBe("2026-08-24T00:00:00.000Z");

    // floor(2 * 1.0 * 1.0 * 0.5)
    expect(result.amount).toBe(1);
  });

  test("mute losses round toward zero and skip cap/taper when unset", async () => {
    const { tx, now, actor, state } = createFakeTx({
      accountAgeDays: 90,
      incomeToday: 500,
      lifetimeAura: 0,
      priorInteractions: 9,
    });

    const result = await applyWeightedAward(tx, {
      actor,
      actorId: ACTOR_ID,
      baseAmount: -MUTE_RECEIVE_AURA,
      now,
      recipientId: RECIPIENT,
      type: "POST_VOTE_REMOVED",
    });

    // No taperClass / cap requested: neither query runs.
    expect(state.countQueries).toHaveLength(0);
    expect(state.aggregateQueries).toHaveLength(0);
    // ceil(-3 * 0.625) = ceil(-1.875) = -1
    expect(result.amount).toBe(-1);
    expect(state.balanceUpdates).toEqual([{ id: RECIPIENT, increment: -1 }]);
  });
});

describe("applyFlatAward", () => {
  test("pays the flat stipend under the cap", async () => {
    const { tx, now, state } = createFakeTx({ incomeToday: 100 });

    const result = await applyFlatAward(tx, {
      actorId: ACTOR_ID,
      baseAmount: 10,
      now,
      recipientId: ACTOR_ID,
      subjectToDailyCap: true,
      type: "POST_CREATION",
    });

    expect(result.amount).toBe(10);
    expect(state.ledgerRows[0]).toMatchObject({
      targetUserId: ACTOR_ID,
      type: "POST_CREATION",
    });
  });

  test("truncates past the daily cap toward zero", async () => {
    const { tx, now } = createFakeTx({ incomeToday: 130 });

    const result = await applyFlatAward(tx, {
      actorId: ACTOR_ID,
      baseAmount: 10,
      now,
      recipientId: ACTOR_ID,
      subjectToDailyCap: true,
      type: "COMMENT_CREATION",
    });

    // trunc(10 * max(0.15, 120/130)) = trunc(9.23)
    expect(result.amount).toBe(9);
  });

  test("caps can reduce a participation stipend to nothing", async () => {
    const { tx, now } = createFakeTx({ incomeToday: 900 });

    const result = await applyFlatAward(tx, {
      actorId: ACTOR_ID,
      baseAmount: 1,
      now,
      recipientId: ACTOR_ID,
      subjectToDailyCap: true,
      type: "COMMENT_CREATION",
    });

    // trunc(1 * max(0.15, 120/900)) = trunc(0.133) = 0
    expect(result.amount).toBe(0);
  });
});

describe("chargeMutingCost", () => {
  test("every mute costs the muter exactly the configured price", async () => {
    const { tx, state } = createFakeTx();

    const result = await chargeMutingCost(tx, {
      muterId: ACTOR_ID,
      postId: "post-1",
    });

    expect(result.amount).toBe(-MUTING_COST_AURA);
    expect(state.balanceUpdates).toEqual([
      { id: ACTOR_ID, increment: -MUTING_COST_AURA },
    ]);
    expect(state.ledgerRows[0]).toMatchObject({
      amount: -MUTING_COST_AURA,
      issuerId: ACTOR_ID,
      targetUserId: ACTOR_ID,
      type: "MUTING_COST",
      userId: ACTOR_ID,
    });
  });
});

describe("reverseExactAura", () => {
  test("reverses an open amplify position exactly", async () => {
    const { tx, state } = createFakeTx();

    const result = await reverseExactAura(tx, {
      issuerId: ACTOR_ID,
      openAmount: 3,
      postId: "post-1",
      recipientId: RECIPIENT,
      type: "POST_VOTE_REMOVED",
    });

    expect(result.amount).toBe(-3);
    expect(state.balanceUpdates).toEqual([{ id: RECIPIENT, increment: -3 }]);
    expect(state.ledgerRows[0]).toMatchObject({
      amount: -3,
      targetUserId: RECIPIENT,
      type: "POST_VOTE_REMOVED",
    });
  });

  test("refunding a muter cost flips the sign back", async () => {
    const { tx, state } = createFakeTx();

    const result = await reverseExactAura(tx, {
      issuerId: ACTOR_ID,
      openAmount: -1,
      postId: "post-1",
      recipientId: ACTOR_ID,
      type: "MUTING_COST",
    });

    expect(result.amount).toBe(1);
    expect(state.ledgerRows[0]).toMatchObject({
      amount: 1,
      type: "MUTING_COST",
    });
  });

  test("zero positions (legacy rows) reverse nothing", async () => {
    const { tx, state } = createFakeTx();

    const result = await reverseExactAura(tx, {
      issuerId: ACTOR_ID,
      openAmount: 0,
      postId: "post-1",
      recipientId: RECIPIENT,
      type: "POST_VOTE_REMOVED",
    });

    expect(result.amount).toBe(0);
    expect(state.balanceUpdates).toHaveLength(0);
    expect(state.ledgerRows).toHaveLength(0);
  });
});

describe("applyModerationPenalty", () => {
  test("docks the configured penalty with an audit row, one-way", async () => {
    const { tx, state } = createFakeTx();

    const result = await applyModerationPenalty(tx, {
      actorId: "admin-1",
      postId: "post-9",
      recipientId: RECIPIENT,
    });

    expect(result.amount).toBe(-100);
    expect(state.balanceUpdates).toEqual([{ id: RECIPIENT, increment: -100 }]);
    expect(state.ledgerRows[0]).toMatchObject({
      amount: -100,
      issuerId: "admin-1",
      postId: "post-9",
      targetUserId: RECIPIENT,
      type: "MODERATION_PENALTY",
      userId: RECIPIENT,
    });
  });
});
