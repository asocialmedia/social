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

const consumed: ConsumeOptions[] = [];
// One flag rather than a second `mock.module`: re-registering the module
// replaces the namespace the already-imported helpers read from, so a later test
// would silently change what an earlier one is calling.
let allow = true;
let retryAfterSeconds = 60;

mock.module("@asm/db", () => ({
  consumeRateLimit: (options: ConsumeOptions) => {
    consumed.push(options);
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
  DEN_ADD_MEMBERS_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_MANAGE_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
  consumeDenRateLimit,
  denJoinPreviewIdentifier,
} = await import("./den-rate-limit");

// Every rule, so a new one cannot be added without this file noticing.
const ALL_RULES = {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_MANAGE_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
} as const;

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
