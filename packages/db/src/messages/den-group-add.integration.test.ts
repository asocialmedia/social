import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  groupAddEligibility,
  groupAddRefusalError,
  groupAddRefusalFor,
  prisma,
} from "@asm/db";

import { DEN_LIMITS } from "./dens";

// The bulk read that decides who may be put in a group, against a live database.
//
// The pure rule is unit-tested in `group-add-policy.test.ts`. What needs a real
// database is the part a mocked query cannot prove: that the follow edge is read
// in the CANDIDATE's direction. It was the other way round until this change, and
// a mock written for the old direction answers the new question perfectly well -
// it is only a real `follows` row that tells the two apart.
//
// The failure this guards against is silent and inverted: a client that follows
// nobody and a client everybody follows would both be refused, and the rule would
// read as random until somebody noticed it was the caller's list being consulted
// instead of the candidate's.

const RUN_ID = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;

const ACTOR = `gadd-actor-${RUN_ID}`;
// Candidates named by the edge they hold towards the actor.
const CANDIDATE_FOLLOWS_ACTOR = `gadd-follows-${RUN_ID}`;
const CANDIDATE_INDEPENDENT = `gadd-independent-${RUN_ID}`;
const CANDIDATE_OPENS = `gadd-opens-${RUN_ID}`;
const CANDIDATE_CLOSED = `gadd-closed-${RUN_ID}`;
// Follows the ACTOR but is not a candidate, so it must not leak into the answer.
const BYSTANDER = `gadd-bystander-${RUN_ID}`;

const CANDIDATE_IDS = [
  CANDIDATE_FOLLOWS_ACTOR,
  CANDIDATE_INDEPENDENT,
  CANDIDATE_OPENS,
  CANDIDATE_CLOSED,
];

async function setPolicy(
  userId: string,
  groupAddPolicy: "EVERYONE" | "FOLLOWING_ONLY" | "NO_DIRECT_ADDS"
): Promise<void> {
  await prisma.orm.public.Users.where({ id: userId }).update({
    groupAddPolicy,
  });
}

beforeAll(async () => {
  await prisma.orm.public.Users.createAll(
    [
      ACTOR,
      CANDIDATE_FOLLOWS_ACTOR,
      CANDIDATE_INDEPENDENT,
      CANDIDATE_OPENS,
      CANDIDATE_CLOSED,
      BYSTANDER,
    ].map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    }))
  );
  // Only ONE candidate follows the actor. The actor follows the bystander and
  // nobody else, so a query reading the actor's own list would produce a
  // different answer for every candidate here.
  await prisma.orm.public.Follows.create({
    followerId: CANDIDATE_FOLLOWS_ACTOR,
    followingId: ACTOR,
  });
  await prisma.orm.public.Follows.create({
    followerId: ACTOR,
    followingId: BYSTANDER,
  });
  await setPolicy(CANDIDATE_OPENS, "EVERYONE");
  await setPolicy(CANDIDATE_CLOSED, "NO_DIRECT_ADDS");
});

afterAll(async () => {
  await prisma.orm.public.Users.where((user) =>
    user.id.in([ACTOR, ...CANDIDATE_IDS, BYSTANDER])
  ).deleteAndCount();
});

describe("groupAddEligibility", () => {
  test("reads the candidate's own following list, not the actor's", async () => {
    const eligibility = await groupAddEligibility(ACTOR, [
      CANDIDATE_FOLLOWS_ACTOR,
      CANDIDATE_INDEPENDENT,
    ]);
    // Both are on the account default, so the only thing separating them is the
    // edge. The first follows the actor and is admitted; the second does not.
    expect(eligibility.get(CANDIDATE_FOLLOWS_ACTOR)).toBeNull();
    expect(eligibility.get(CANDIDATE_INDEPENDENT)).toBe("NOT_FOLLOWING_YOU");
  });

  test("an open setting admits somebody who follows nobody", async () => {
    // The user's first requirement: anybody, followed or not.
    const eligibility = await groupAddEligibility(ACTOR, [CANDIDATE_OPENS]);
    expect(eligibility.get(CANDIDATE_OPENS)).toBeNull();
  });

  test("a closed setting refuses somebody who does follow the actor", async () => {
    // Following them must not be a way around it.
    const eligibility = await groupAddEligibility(ACTOR, [
      CANDIDATE_CLOSED,
      CANDIDATE_FOLLOWS_ACTOR,
    ]);
    expect(eligibility.get(CANDIDATE_CLOSED)).toBe("NO_DIRECT_ADDS");
    expect(eligibility.get(CANDIDATE_FOLLOWS_ACTOR)).toBeNull();
  });

  test("a candidate's own follow of the actor is the only edge that counts", async () => {
    // The actor follows the bystander, which under the old direction would have
    // made every candidate here addable. Asserting the bystander is absent too,
    // because a query that ignored its id filter would pass the rest.
    const eligibility = await groupAddEligibility(ACTOR, [
      CANDIDATE_IDS[1] as string,
    ]);
    expect(eligibility.size).toBe(1);
    expect(eligibility.has(BYSTANDER)).toBe(false);
  });

  test("omits an account with no row rather than reporting it addable", async () => {
    // The caller reports a missing account with a better message than this could,
    // so answering "addable" for a row that is not there would be a claim.
    const eligibility = await groupAddEligibility(ACTOR, ["gadd-missing"]);
    expect(eligibility.has("gadd-missing")).toBe(false);
  });

  test("excludes the actor from their own answer", async () => {
    const eligibility = await groupAddEligibility(ACTOR, [ACTOR]);
    expect(eligibility.size).toBe(0);
  });

  test("answers a whole roster in two queries' worth of reads", async () => {
    // Not asserted as a query count - the shape that matters is that a full
    // den-sized roster resolves at all, which a per-id loop would make slow
    // enough to be obvious.
    const roster = Array.from(
      { length: DEN_LIMITS.membersMax },
      (_unused, index) => `gadd-roster-${RUN_ID}-${index}`
    );
    await prisma.orm.public.Users.createAll(
      roster.map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    try {
      const eligibility = await groupAddEligibility(ACTOR, roster);
      // Every roster account is on the default and none of them follow the actor,
      // so every one is refused for the same reason.
      expect(eligibility.size).toBe(roster.length);
      expect([...new Set(eligibility.values())]).toEqual(["NOT_FOLLOWING_YOU"]);
    } finally {
      await prisma.orm.public.Users.where((user) =>
        user.id.in(roster)
      ).deleteAndCount();
    }
  }, 30_000);
});

describe("groupAddRefusalFor", () => {
  test("names one refusal for the whole roster, not one per candidate", async () => {
    const refusal = await groupAddRefusalFor(ACTOR, [
      CANDIDATE_FOLLOWS_ACTOR,
      CANDIDATE_CLOSED,
    ]);
    expect(refusal).toEqual({
      code: "NO_DIRECT_ADDS",
      error: groupAddRefusalError("NO_DIRECT_ADDS"),
    });
  });

  test("answers nothing when every candidate may be added", async () => {
    expect(
      await groupAddRefusalFor(ACTOR, [
        CANDIDATE_FOLLOWS_ACTOR,
        CANDIDATE_OPENS,
      ])
    ).toBeNull();
  });

  test("the error is about the roster, so it survives without naming anybody", () => {
    // No candidate id in the sentence: a roster is proposed as one act, and
    // naming which of ninety-nine people is the problem is a worse answer.
    expect(groupAddRefusalError("NOT_FOLLOWING_YOU")).not.toContain(
      CANDIDATE_INDEPENDENT
    );
  });
});
