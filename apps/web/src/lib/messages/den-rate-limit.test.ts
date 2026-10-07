import { describe, expect, mock, test } from "bun:test";

// The den limiter's policy, tested as policy.
//
// The route tests already prove each route CALLS a limiter. What they cannot see
// is whether the buckets are the right shape, and that is where the abuse
// actually lives: two operations sharing a budget means one of them can starve
// the other, and a limit that is loose enough to be useless is as much a gap as
// one that is tight enough to break the product.
//
// Redis is not involved: these are data assertions about which bucket an
// operation spends from and how big that bucket is, and the counting itself is
// `consumeRateLimit`'s problem (covered in packages/db).
interface ConsumeOptions {
  bucket: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}

interface DenRateLimitRule {
  bucket: string;
  limit: number;
  window: "fixed" | "sliding";
  windowSeconds: number;
}

const consumed: ConsumeOptions[] = [];
// One flag rather than a second `mock.module`: re-registering the module
// replaces the namespace the already-imported helpers read from, so a later test
// would silently change what an earlier one is calling.
let allow = true;
let retryAfterSeconds = 60;

// Which window shape a rule asked for, recorded per consume so a test can assert
// the sliding/fixed decision rather than infer it from a bucket name. Two
// parallel lists because a rule picks exactly one of the two helpers, and
// "neither was called" is itself an assertion worth being able to make.
const slidingConsumed: ConsumeOptions[] = [];

// Makes both helpers throw, which is how the fail-open guard in
// `consumeDenRateLimit` is exercised without needing Redis to be down. The
// helpers' own fail-open path against an unreachable Redis is covered in
// packages/db, where the client is real.
const brokenHelpers = { throwOnConsume: false };

mock.module("@asm/db", () => ({
  consumeRateLimit: (options: ConsumeOptions) => {
    consumed.push(options);
    if (brokenHelpers.throwOnConsume) {
      return Promise.reject(new Error("limiter exploded"));
    }
    return Promise.resolve({
      allowed: allow,
      remaining: allow ? options.limit - 1 : 0,
      resetAt: Date.now() + options.windowSeconds * 1000,
      retryAfterSeconds,
    });
  },
  consumeRateLimitSliding: (options: ConsumeOptions) => {
    slidingConsumed.push(options);
    if (brokenHelpers.throwOnConsume) {
      return Promise.reject(new Error("limiter exploded"));
    }
    return Promise.resolve({
      allowed: allow,
      remaining: allow ? options.limit - 1 : 0,
      resetAt: Date.now() + options.windowSeconds * 1000,
      retryAfterSeconds,
    });
  },
  getTrustedIngressIp: (headers: Pick<Headers, "get">) =>
    headers.get("cf-connecting-ip")?.trim() ?? "unknown",
  hashViewerId: (ip: string) => `hashed-${ip}`,
}));

const {
  DEN_ACTIVITY_STREAM_RATE_LIMIT,
  DEN_ADD_ELIGIBILITY_RATE_LIMIT,
  DEN_ADD_MEMBERS_RATE_LIMIT,
  DEN_BANS_LIST_RATE_LIMIT,
  DEN_BAN_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DELIVERY_RECEIPT_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_DM_CREATE_RATE_LIMIT,
  DEN_INVITE_ROTATE_RATE_LIMIT,
  DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_KEY_EPOCH_RATE_LIMIT,
  DEN_LEAVE_RATE_LIMIT,
  DEN_MESSAGE_DELETE_RATE_LIMIT,
  DEN_MESSAGE_EDIT_RATE_LIMIT,
  DEN_MESSAGE_HIDE_RATE_LIMIT,
  DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
  DEN_MESSAGE_SEND_RATE_LIMIT,
  DEN_PREFS_RATE_LIMIT,
  DEN_PRESENCE_RATE_LIMIT,
  DEN_READ_RECEIPT_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
  DEN_STREAM_RATE_LIMIT,
  DEN_TYPING_RATE_LIMIT,
  DEN_USER_SEARCH_RATE_LIMIT,
  DEN_WALLPAPER_RATE_LIMIT,
  consumeDenJoinRateLimit,
  consumeDenRateLimit,
  denJoinPreviewIdentifier,
} = await import("./den-rate-limit");

// Every rule, so a new one cannot be added without this file noticing.
const ALL_RULES = {
  DEN_ACTIVITY_STREAM_RATE_LIMIT,
  DEN_ADD_ELIGIBILITY_RATE_LIMIT,
  DEN_ADD_MEMBERS_RATE_LIMIT,
  DEN_BANS_LIST_RATE_LIMIT,
  DEN_BAN_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DELIVERY_RECEIPT_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_DM_CREATE_RATE_LIMIT,
  DEN_INVITE_ROTATE_RATE_LIMIT,
  DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_KEY_EPOCH_RATE_LIMIT,
  DEN_LEAVE_RATE_LIMIT,
  DEN_MESSAGE_DELETE_RATE_LIMIT,
  DEN_MESSAGE_EDIT_RATE_LIMIT,
  DEN_MESSAGE_HIDE_RATE_LIMIT,
  DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
  DEN_MESSAGE_SEND_RATE_LIMIT,
  DEN_PREFS_RATE_LIMIT,
  DEN_PRESENCE_RATE_LIMIT,
  DEN_READ_RECEIPT_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
  DEN_STREAM_RATE_LIMIT,
  DEN_TYPING_RATE_LIMIT,
  DEN_USER_SEARCH_RATE_LIMIT,
  DEN_WALLPAPER_RATE_LIMIT,
} as const;

// The membership mutations that sit on an hour-long fixed window, as opposed to the
// hot paths that slide. A list rather than a threshold, so the split is stated and
// somebody adding an hourly management operation has to decide where it goes instead
// of inheriting an answer from a window length.
//
// Named for what the group IS rather than for when it was written: it started as "the
// buckets that predate the conversation-route pass" and grew by one when bans landed,
// which is exactly the kind of name that stops describing its contents. The reason
// hour-long fixed is acceptable here is the one on the test below - at 3600s the worst
// a fixed window allows is two budget-fills across a single boundary.
const HOURLY_FIXED_RULES: Record<string, DenRateLimitRule> = {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  // Reading the list the panel refetches after every one of those writes.
  DEN_BANS_LIST_RATE_LIMIT,
  // Bans and unbans. Both are single-row writes a manager makes by hand, and a ban
  // is the one management operation that targets a PERSON rather than a den, so it
  // keeps its own budget rather than sharing the removal one - a kick loop and a ban
  // loop are different abuses with different blast radii.
  DEN_BAN_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
};
function headersWith(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("den rate-limit buckets", () => {
  test("no two den operations share a bucket", () => {
    // The reason `den-manage` was split. A shared budget is a shared failure: an
    // operation that can be driven in a loop spends the budget an operation that
    // cannot, and the second one starts answering 429 for a user who did nothing
    // wrong. Naming every bucket separately is what makes that impossible to
    // reintroduce by adding a rule.
    const buckets = Object.values(ALL_RULES).map((rule) => rule.bucket);
    expect(buckets.length).toBe(new Set(buckets).size);
  });

  test("a rename cannot spend the budget a role change needs", () => {
    // The specific split this pass made, asserted as the two operations rather
    // than as the two bucket names, so renaming a bucket does not quietly
    // re-merge them.
    expect(DEN_DETAILS_RATE_LIMIT.bucket).not.toBe(DEN_ROLES_RATE_LIMIT.bucket);
    // And a rename is the looser of the two, because it is the one a client can
    // put in a loop; a role change is the tighter, because every call that
    // succeeds really did change who can do what.
    expect(DEN_DETAILS_RATE_LIMIT.limit).toBeGreaterThan(
      DEN_ROLES_RATE_LIMIT.limit
    );
  });

  test("the budgets run from the most expensive operation to the least", () => {
    // Proportionate, in the order the work actually costs:
    //
    //   create   writes the conversation row, the owner row, every member row and
    //            the den's first key epoch;
    //   dissolve deletes the conversation row and everything cascading off it;
    //   add     one claim, one roster read, one row per member;
    //   join    one claim, one roster read, one row;
    //   the rest are single-row updates nobody can put in a loop.
    //
    // A budget that is tightest on the cheapest operation is a budget spent
    // defending the wrong thing, so the ordering is asserted rather than assumed.
    expect(DEN_CREATE_RATE_LIMIT.limit).toBeLessThanOrEqual(
      DEN_DISSOLVE_RATE_LIMIT.limit
    );
    expect(DEN_DISSOLVE_RATE_LIMIT.limit).toBeLessThanOrEqual(
      DEN_ADD_MEMBERS_RATE_LIMIT.limit
    );
    expect(DEN_ADD_MEMBERS_RATE_LIMIT.limit).toBeLessThanOrEqual(
      DEN_JOIN_RATE_LIMIT.limit
    );
    expect(DEN_JOIN_RATE_LIMIT.limit).toBeLessThanOrEqual(
      DEN_ROLES_RATE_LIMIT.limit
    );
    expect(DEN_ROLES_RATE_LIMIT.limit).toBeLessThanOrEqual(
      DEN_REMOVE_MEMBER_RATE_LIMIT.limit
    );
  });

  test("the preview is metered at least as tightly as the join behind it", () => {
    // A join writes a membership row under a claim lock. The preview only reads,
    // and that is exactly why it is the tighter of the two: it needs no session,
    // so anybody can drive it, and its 200-versus-404 answer is the one signal a
    // sweep would be reading. A door that is cheaper to call and open to
    // anonymous callers cannot also have the looser budget.
    expect(DEN_JOIN_PREVIEW_RATE_LIMIT.limit).toBeLessThanOrEqual(
      DEN_JOIN_RATE_LIMIT.limit
    );
    expect(DEN_JOIN_PREVIEW_RATE_LIMIT.bucket).not.toBe(
      DEN_JOIN_RATE_LIMIT.bucket
    );
  });

  test("every bucket is a real budget, not an accidental zero or infinity", () => {
    for (const [name, rule] of Object.entries(ALL_RULES)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowSeconds).toBeGreaterThan(0);
      expect(rule.bucket.length).toBeGreaterThan(0);
      expect(name).toMatch(/^DEN_[A-Z_]+_RATE_LIMIT$/u);
    }
  });

  test("no rule is missing from the table this file audits", () => {
    // The table is the whole policy surface. A rule exported from the module but
    // left out of ALL_RULES would skip the uniqueness assertion above and the
    // sliding-window assertion below, which is the failure this whole file
    // exists to prevent.
    const audited = new Set(Object.keys(ALL_RULES));
    const known = new Set([
      ...Object.keys(HOURLY_FIXED_RULES),
      ...Object.keys(ALL_RULES),
    ]);
    for (const name of audited) {
      expect(known.has(name)).toBe(true);
    }
    expect(audited.size).toBe(known.size);
  });

  test("every bucket a client can hammer in a tight loop slides", () => {
    // A fixed window on a short bucket is not a weaker limiter, it is barely
    // one: the stated budget is really 2x, because a caller can spend it all at
    // the end of one window and all of it again at the start of the next. On a
    // ten-second typing budget that is 60 events inside 200ms, which is the
    // entire attack. So the rule here is not a threshold but a list, and the
    // first entry that somebody adds to a short bucket without sliding fails.
    const shortWindowRules: Record<string, DenRateLimitRule> = {
      DEN_MESSAGE_SEND_RATE_LIMIT,
      DEN_TYPING_RATE_LIMIT,
    };
    for (const rule of Object.values(shortWindowRules)) {
      expect(rule.window).toBe("sliding");
      expect(rule.windowSeconds).toBeLessThanOrEqual(60);
    }
  });

  test("the hourly membership mutations keep their fixed windows", () => {
    // Stated rather than left implicit, because the split is deliberate and
    // needs defending in both directions. At 3600s the worst a fixed window
    // allows is two budget-fills across one boundary; for a ten-per-hour create
    // budget that is twenty creates, which is not what anyone is defending
    // against. Turning them sliding would cost Redis memory and buy nothing.
    for (const rule of Object.values(HOURLY_FIXED_RULES)) {
      expect(rule.window).toBe("fixed");
      expect(rule.windowSeconds).toBe(3600);
    }
  });

  test("every bucket outside the hourly membership mutations slides", () => {
    const names = new Set(Object.keys(HOURLY_FIXED_RULES));
    for (const [name, rule] of Object.entries(ALL_RULES)) {
      if (names.has(name)) {
        continue;
      }
      expect({ [name]: rule.window }).toEqual({ [name]: "sliding" });
    }
  });

  test("the send budgets are ordered so the burst ceiling is the tighter one", () => {
    // Twenty per ten seconds is two a second; six hundred an hour is ten a
    // minute. A caller who respects the short budget can still put 6,840
    // messages through in an hour, so the long one cannot be looser than the
    // short one expressed as a rate or it would never bind anyone the short one
    // is not already stopping.
    const burstPerSecond =
      DEN_MESSAGE_SEND_RATE_LIMIT.limit /
      DEN_MESSAGE_SEND_RATE_LIMIT.windowSeconds;
    const sustainedPerSecond =
      DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.limit /
      DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.windowSeconds;
    expect(sustainedPerSecond).toBeLessThan(burstPerSecond);
  });

  test("every high-frequency budget clears twice the rate the shipped client produces", () => {
    // The numbers on the left are measured from the client rather than guessed,
    // because this is the assertion that stops a rate-limiting pass from
    // producing visible errors on normal use:
    //
    //   typing    the composer heartbeats once per 3s while it is non-empty
    //   presence  one shared heartbeat every 30s across every mounted consumer
    //   read      an 800ms debounce, once per open thread
    //   delivered a 1.5s debounce, once per inbound message
    //   streams   the reconnect ladder, generously five seconds apart
    //   send      one per keypress, which a person cannot beat
    //
    // Twice is the floor and several of these clear it by far more. A bucket
    // added to this table with a number derived from anything other than what
    // the client does has to say so here.
    const CLIENT_RATE_PER_SECOND: Record<string, number> = {
      [DEN_ACTIVITY_STREAM_RATE_LIMIT.bucket]: 1 / 5,
      [DEN_DELIVERY_RECEIPT_RATE_LIMIT.bucket]: 1 / 1.5,
      [DEN_MESSAGE_SEND_RATE_LIMIT.bucket]: 1,
      [DEN_PRESENCE_RATE_LIMIT.bucket]: 1 / 30,
      [DEN_READ_RECEIPT_RATE_LIMIT.bucket]: 1,
      [DEN_STREAM_RATE_LIMIT.bucket]: 1 / 5,
      [DEN_TYPING_RATE_LIMIT.bucket]: 1 / 3,
    };
    for (const rule of Object.values(ALL_RULES)) {
      const clientRate = CLIENT_RATE_PER_SECOND[rule.bucket];
      if (clientRate === undefined) {
        continue;
      }
      expect(rule.limit / rule.windowSeconds).toBeGreaterThanOrEqual(
        clientRate * 2
      );
    }
  });

  test("a receipt is never a cheaper flood target than sending into the thread", () => {
    // Receipts fire per inbound message, so they legitimately sit alongside the
    // send rate rather than under it. What they must not do is fall below it: a
    // thread somebody else is flooding would otherwise be the cheaper way in.
    const send =
      DEN_MESSAGE_SEND_RATE_LIMIT.limit /
      DEN_MESSAGE_SEND_RATE_LIMIT.windowSeconds;
    for (const rule of [
      DEN_READ_RECEIPT_RATE_LIMIT,
      DEN_DELIVERY_RECEIPT_RATE_LIMIT,
    ]) {
      expect(rule.limit / rule.windowSeconds).toBeGreaterThanOrEqual(send);
    }
  });

  test("rotation is tighter than the other single-row membership mutations", () => {
    // Rotation used to share `den-manage` with leaving at 120 an hour, which is
    // defensible for a leave - it costs the caller one row - and not defensible
    // for a rotation, which retires a door other people are walking through. The
    // split is the whole reason, so the ordering it argues for is asserted
    // against the buckets that share that reasoning.
    //
    // Create is left out on purpose: it is tighter still, at 10 an hour, for the
    // unrelated and stronger reason that it is the most expensive write in the
    // feature.
    for (const rule of [
      DEN_LEAVE_RATE_LIMIT,
      DEN_DETAILS_RATE_LIMIT,
      DEN_ROLES_RATE_LIMIT,
    ]) {
      expect(rule.windowSeconds).toBe(3600);
      expect(rule.limit).toBeGreaterThan(DEN_INVITE_ROTATE_RATE_LIMIT.limit);
    }
    expect(DEN_CREATE_RATE_LIMIT.limit).toBeLessThan(
      DEN_INVITE_ROTATE_RATE_LIMIT.limit
    );
  });

  test("handing the den over spends the roles budget, and gets no bucket of its own", () => {
    // The one sharing the "no two operations share a bucket" rule does not
    // object to, because the two operations cannot compete: a transfer is
    // owner-only, needs a confirmation, and is rarer than a promotion, so a
    // separate budget could only be a looser one. What must not happen is a
    // bucket of its own appearing next to this one, so this test names the
    // absence as well as the presence - a new DEN_TRANSFER_* rule would fail it.
    expect(
      Object.values(ALL_RULES).filter(
        (rule) => rule.bucket === DEN_ROLES_RATE_LIMIT.bucket
      )
    ).toHaveLength(1);
    expect(
      Object.keys(ALL_RULES).some((name) => name.includes("TRANSFER"))
    ).toBe(false);
  });
});

describe("consumeDenRateLimit", () => {
  test("spends the rule it is handed, per user", async () => {
    consumed.length = 0;
    slidingConsumed.length = 0;
    allow = true;
    expect(await consumeDenRateLimit(DEN_JOIN_RATE_LIMIT, "user-1")).toBeNull();
    expect(consumed).toEqual([
      {
        bucket: DEN_JOIN_RATE_LIMIT.bucket,
        identifier: "user-1",
        limit: DEN_JOIN_RATE_LIMIT.limit,
        windowSeconds: DEN_JOIN_RATE_LIMIT.windowSeconds,
      },
    ]);
    // A fixed-window rule must not reach for the sliding helper, or the two
    // would be indistinguishable at the call site.
    expect(slidingConsumed).toEqual([]);
  });

  test("a sliding rule spends the sliding helper, not the fixed one", async () => {
    consumed.length = 0;
    slidingConsumed.length = 0;
    allow = true;
    expect(
      await consumeDenRateLimit(DEN_MESSAGE_SEND_RATE_LIMIT, "user-1")
    ).toBeNull();
    expect(slidingConsumed).toEqual([
      {
        bucket: DEN_MESSAGE_SEND_RATE_LIMIT.bucket,
        identifier: "user-1",
        limit: DEN_MESSAGE_SEND_RATE_LIMIT.limit,
        windowSeconds: DEN_MESSAGE_SEND_RATE_LIMIT.windowSeconds,
      },
    ]);
    expect(consumed).toEqual([]);
  });

  test("every rule in the table routes to exactly one of the two helpers", async () => {
    // This is the assertion that makes the `window` field load-bearing rather
    // than documentation.
    allow = true;
    consumed.length = 0;
    slidingConsumed.length = 0;
    // Every rule has to reach the helper its own `window` field names. A rule
    // whose field and helper disagreed would be a limiter silently running on the
    // wrong algorithm, and nothing else in this file would notice.
    const sliding = Object.values(ALL_RULES).filter(
      (rule) => rule.window === "sliding"
    );
    const fixed = Object.values(ALL_RULES).filter(
      (rule) => rule.window === "fixed"
    );
    expect(sliding.length + fixed.length).toBe(Object.keys(ALL_RULES).length);
    expect(fixed.length).toBeGreaterThan(0);

    const verdicts = await Promise.all(
      Object.values(ALL_RULES).map((rule) =>
        consumeDenRateLimit(rule, "user-1")
      )
    );
    expect(verdicts).toEqual(
      Array.from({ length: verdicts.length }, () => null)
    );
    expect(slidingConsumed.length).toBe(sliding.length);
    expect(consumed.length).toBe(fixed.length);
  });

  test("a limiter that throws fails open rather than rejecting the request", async () => {
    // The helpers already fail open on a Redis outage, which is covered in
    // packages/db against a real failing client. This is the layer above them:
    // AGENTS.md requires that a limiter which throws never 500s a route, so a
    // bug in the limiter degrades to no limit instead of taking a send or a
    // heartbeat down for a real user.
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args[1]);
    };
    try {
      brokenHelpers.throwOnConsume = true;
      expect(
        await consumeDenRateLimit(DEN_TYPING_RATE_LIMIT, "user-1")
      ).toBeNull();
      expect(
        await consumeDenRateLimit(DEN_JOIN_RATE_LIMIT, "user-1")
      ).toBeNull();
    } finally {
      brokenHelpers.throwOnConsume = false;
      console.error = original;
    }
    // Logged, not swallowed: a limiter that fails silently is a limiter nobody
    // will notice is broken.
    expect(logged).toHaveLength(2);
    expect(logged[0]).toBeInstanceOf(Error);
  });

  test("returns the 429 with a retry-after rather than a bare refusal", async () => {
    allow = false;
    retryAfterSeconds = 42;
    try {
      const response = await consumeDenRateLimit(DEN_JOIN_RATE_LIMIT, "user-1");
      expect(response?.status).toBe(429);
      // The header is the part clients actually need; a limiter that omits it
      // forces every caller to invent its own backoff.
      expect(response?.headers.get("retry-after")).toBe("42");
    } finally {
      allow = true;
    }
  });
});

describe("consumeDenJoinRateLimit", () => {
  // The join door is the one surface where fail-open removes the last bound on
  // an attack: the preview budget is what makes sweeping the 36^6 short-code
  // space irrational, and an unbounded preview during a Redis outage is the
  // sweep running for free. So the door DEGRADES instead of failing open - a
  // process-local window, no Redis - while every other bucket in this file
  // keeps its fail-open contract.
  test("counts through the same buckets while Redis answers", async () => {
    const before = consumed.length;
    const slidingBefore = slidingConsumed.length;
    expect(
      await consumeDenJoinRateLimit(DEN_JOIN_RATE_LIMIT, "joiner-1")
    ).toBeNull();
    expect(consumed.length).toBe(before + 1);
    expect(slidingConsumed.length).toBe(slidingBefore);
    expect(consumed.at(-1)?.bucket).toBe(DEN_JOIN_RATE_LIMIT.bucket);
  });

  test("a limiter that throws degrades to a local window instead of failing open", async () => {
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args[1]);
    };
    try {
      brokenHelpers.throwOnConsume = true;
      // The degraded window admits up to the rule's own budget.
      expect(
        await consumeDenJoinRateLimit(DEN_JOIN_RATE_LIMIT, "degraded-1")
      ).toBeNull();
      expect(
        await consumeDenJoinRateLimit(DEN_JOIN_PREVIEW_RATE_LIMIT, "degraded-2")
      ).toBeNull();
      // A DIFFERENT bucket is its own degraded window, mirroring the bucket
      // separation the Redis limiter keeps.
      expect(
        await consumeDenJoinRateLimit(DEN_JOIN_RATE_LIMIT, "degraded-1")
      ).toBeNull();
      // The window's ceiling is the rule's own limit, so flooding to exactly
      // the boundary and one past it is what a refill helper is for. The
      // counting must be sequential - each hit fills the same degraded window
      // - but the helper reads one call at a time by design.
      let refused: Response | null = null;
      for (
        let i = 0;
        i < DEN_JOIN_RATE_LIMIT.limit + 1 && refused === null;
        i += 1
      ) {
        // oxlint-disable-next-line no-await-in-loop -- the window counts each hit, so they must be sequential
        refused = await consumeDenJoinRateLimit(DEN_JOIN_RATE_LIMIT, "flood-1");
      }
      expect(refused?.status).toBe(429);
      expect(refused?.headers.get("retry-after")).toBeTruthy();
    } finally {
      brokenHelpers.throwOnConsume = false;
      console.error = original;
    }
    expect(logged.length).toBeGreaterThanOrEqual(1);
  });
});

describe("denJoinPreviewIdentifier", () => {
  test("a signed-in viewer is metered per account", () => {
    expect(denJoinPreviewIdentifier(headersWith({}), "user-1")).toBe(
      "u:user-1"
    );
  });

  test("a signed-out viewer is metered per ingress IP, hashed", () => {
    // The preview needs no session - an invite link is followed by people who are
    // not signed in yet - so "no session" must not mean "no limit". The address
    // is hashed because a raw one sitting in a Redis key is a location in a log.
    expect(
      denJoinPreviewIdentifier(
        headersWith({ "cf-connecting-ip": "203.0.113.7" })
      )
    ).toBe("a:hashed-203.0.113.7");
  });

  test("a client cannot forge a fresh budget with its own forwarding headers", () => {
    // Only the ingress header counts. `x-forwarded-for` is set by whoever is
    // making the request, so honouring it would let a sweep mint an unlimited
    // number of budgets by varying it.
    const forged = denJoinPreviewIdentifier(
      headersWith({ "x-forwarded-for": "198.51.100.1" })
    );
    const noHeader = denJoinPreviewIdentifier(headersWith({}));
    expect(forged).toBe(noHeader);
  });

  test("the account budget and the address budget cannot collide", () => {
    // Prefixed by kind, so an account's preview hits and an anonymous viewer's
    // hits are counted against different keys even when the hash and the user id
    // happen to look alike.
    const signedIn = denJoinPreviewIdentifier(headersWith({}), "a:hashed-x");
    const signedOut = denJoinPreviewIdentifier(
      headersWith({ "cf-connecting-ip": "x" })
    );
    expect(signedIn).not.toBe(signedOut);
  });
});
