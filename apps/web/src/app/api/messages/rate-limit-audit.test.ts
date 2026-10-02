import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Every handler on every messages route must either spend a budget or be named
// here with a reason. This is the shape `den-rate-limit.test.ts` already uses for
// buckets - the same argument one layer up. The route tests prove each handler
// CALLS a limiter; they cannot see a handler that was added without one, which
// is the failure this exists for.
//
// The scan is over the real source tree rather than a hand-maintained list, so a
// new handler cannot be added without this file noticing. The files are READ
// rather than imported, deliberately: importing every route would pull the whole
// Prisma and Redis graph into one process, and the question here is purely
// lexical - does this handler name a limiter, or does the allowlist vouch for
// it? The split is by METHOD rather than by file, because several routes are
// mixed: `conversations/route.ts` meters the create and deliberately does not
// meter the inbox list, and a file-level allowlist could not say that.
const MESSAGES_ROOT = path.join(import.meta.dir, ".");

interface Handler {
  body: string;
  method: string;
  relativePath: string;
}

function routeFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const child = path.join(directory, entry);
    if (statSync(child).isDirectory()) {
      found.push(...routeFiles(child));
    } else if (entry === "route.ts") {
      found.push(child);
    }
  }
  return found.toSorted();
}

// A handler that mentions one of these has a limiter. Both spellings are accepted
// because both are legitimate: `consumeDenRateLimit` for the per-account rules in
// `lib/messages/den-rate-limit.ts`, and a direct `consumeRateLimit` for the two
// budgets that predate them (the history walk and the cursor page) and live in
// the route itself.
const LIMITER_MARKERS = ["consumeDenRateLimit", "consumeRateLimit"];

// Each handler deliberately left unmetered, keyed `METHOD path`, with the reason
// it survives review.
//
// Every entry is an ALLOW, not an oversight: the person adding a handler has to
// move a name in or a reason in rather than inherit silence. The reasons are
// load-bearing - "unknown" and "TODO" are not acceptable answers.
//
// All of these are reads, or writes that create nothing, or writes whose own
// bound is already enforced by something a client cannot lie about. What they do
// NOT cover is a single account looping, and for that they have the per-IP tier
// guard in `lib/security/api-security.ts`, which runs in proxy.ts over every /api
// path at 240 requests a minute. That guard is per ADDRESS, so it is the backstop
// for a flood from one place and not for a distributed one - which is the honest
// limit of what a deliberately-unlimited read gets, and the reason a genuinely
// expensive read (search, send) is metered instead of listed here.
const UNLIMITED_HANDLERS: Record<string, string> = {
  "DELETE blocks/[userId]/route.ts":
    "One indexed delete against a row the caller owns. Unblocking cannot be looped into any state a caller does not already control.",
  "DELETE identity/route.ts":
    "The documented self-scoped recovery path. It deletes the caller's own identity and only the caller's own key wraps, is idempotent, and already leaves the caller's own history unreadable to them. A loop buys nothing after the first call.",
  "GET blocks/route.ts":
    "A read hard-capped at BLOCK_LIST_LIMIT (100) rows in the route, so the response cannot grow with the caller's list.",
  "GET conversations/[id]/events/route.ts":
    "The den's membership log, read on every thread open alongside the conversation detail. Bounded by the number of roster moves a den has ever recorded, which is bounded by membership churn rather than by traffic, and it fans out to nothing.",
  "GET conversations/[id]/route.ts":
    "Conversation detail: the conversation, every key wrap, and the caller's sent count. Fetched on open, on every membership change, and after any key rotation. Bounded by one conversation's roster, which a den caps at DEN_LIMITS.membersMax.",
  "GET conversations/route.ts":
    "The inbox list. Re-read on every message-created activity event, on every tab that mounts, and on every pagination step, so any budget tight enough to stop a loop produces visible errors on ordinary use. One cursor page of 20 conversations per call.",
  "GET dens/[id]/members/route.ts":
    "One roster, capped at DEN_LIMITS.membersMax, with no fan-out and no write. The POST on this route IS metered on den-add-members.",
  "GET dens/[id]/route.ts":
    "The den detail read, the sibling of the conversation detail read above and bounded the same way: one den, one roster capped at DEN_LIMITS.membersMax. The PATCH on this route IS metered on den-details.",
  "GET identity/route.ts":
    "A primary-key read of the caller's own single identity row. One row, by primary key, behind a session.",
  "GET presence/route.ts":
    "A read of the caller's follow graph plus two Redis set reads. The POST on this route IS metered on den-presence, because an unbounded idempotent write loop is a different problem from a bounded read.",
  "GET unread-count/route.ts":
    "Served from a Redis counter, and the grouped database read behind it runs at most once per counter lifetime. A caller cannot force a reseed, so a loop costs one Redis GET.",
  "POST blocks/route.ts":
    "Two indexed reads and one insert, and a block is not a message: no notification, no fan-out, no unread badge for anybody. Re-blocking an existing pair is already a no-op, so a loop stores nothing.",
  "POST identity/route.ts":
    "Create-only: it answers 409 forever after the first success, so one account can write this row once for the life of the account. A bounded number of writes is already a limit.",
};

function relativeRoutePath(absolute: string): string {
  return absolute.slice(MESSAGES_ROOT.length + 1);
}

// The handlers the scan found, and which of them spend a budget.
const DISCOVERED: Handler[] = routeFiles(MESSAGES_ROOT).flatMap((absolute) => {
  const source = readFileSync(absolute, "utf-8");
  const relativePath = relativeRoutePath(absolute);
  // Split on the handler declarations. Each chunk from a declaration up to the
  // next one is that handler's body, so a limiter in GET cannot make POST look
  // metered - which is the whole reason this is method-scoped.
  // `(?<open>\()` rather than a bare group: the split needs a group but nothing
  // here uses it, so naming it says so out loud rather than leaving an unnamed
  // capture for a reader to wonder about.
  // Each handler body runs from its own declaration to the next one, sliced by
  // index rather than by split, so a limiter inside GET cannot make POST look
  // metered. That is the whole reason this is method-scoped.
  const declarations = [
    ...source.matchAll(/export async function (?<method>[A-Z]+)\s*[(]/gu),
  ];
  return declarations.map((declaration, index) => {
    const next = declarations[index + 1];
    const start = declaration.index + declaration[0].length;
    const body = source.slice(start, next?.index ?? source.length);
    return {
      body,
      method: declaration.groups?.method ?? "UNKNOWN",
      relativePath,
    };
  });
});

function key(handler: Handler): string {
  return `${handler.method} ${handler.relativePath}`;
}

function isMetered(handler: Handler): boolean {
  return LIMITER_MARKERS.some((marker) => handler.body.includes(marker));
}

const UNCOVERED = DISCOVERED.filter(
  (handler) => !isMetered(handler) && !UNLIMITED_HANDLERS[key(handler)]
);

const METERED_BUT_ALLOWLISTED = DISCOVERED.filter(
  (handler) => isMetered(handler) && UNLIMITED_HANDLERS[key(handler)]
);

const STALE_ALLOWLIST_ENTRIES = Object.keys(UNLIMITED_HANDLERS).filter(
  (entry) => !DISCOVERED.some((handler) => key(handler) === entry)
);

describe("messages route rate-limit audit", () => {
  test("the scan found every handler", () => {
    // A scan that silently found nothing would make every other test in this file
    // pass while proving nothing, so the floor is pinned: this surface has a lot
    // of handlers and the number is here to catch an empty result.
    expect(DISCOVERED.length).toBeGreaterThan(30);
    expect(
      DISCOVERED.some(
        (handler) =>
          handler.relativePath === "conversations/[id]/messages/route.ts" &&
          handler.method === "POST"
      )
    ).toBe(true);
    expect(
      DISCOVERED.some(
        (handler) =>
          handler.relativePath === "dens/join/[code]/route.ts" &&
          handler.method === "GET"
      )
    ).toBe(true);
  });

  test("every messages handler either spends a budget or has a reason", () => {
    // The assertion the whole file exists for. Adding a handler with no limiter
    // and no entry here fails this test with the handler named.
    expect(UNCOVERED.map(key)).toEqual([]);
  });

  test("the allowlist does not vouch for a handler that is already metered", () => {
    // The dangerous direction of a stale allowlist: somebody DELETES a limiter
    // and leaves the name behind, and the audit keeps passing because the
    // allowlist now says the handler is fine unmetered. Asserting the inverse
    // closes it.
    expect(METERED_BUT_ALLOWLISTED.map(key)).toEqual([]);
  });

  test("the allowlist has no entry for a handler that no longer exists", () => {
    expect(STALE_ALLOWLIST_ENTRIES).toEqual([]);
  });

  test("every allowlist entry says what the handler costs, not just that it is fine", () => {
    for (const [_handlerKey, reason] of Object.entries(UNLIMITED_HANDLERS)) {
      // A reason short enough to be a shrug.
      expect(reason.length).toBeGreaterThan(60);
      // And a reason that names a concrete bound or a concrete property of the
      // handler, rather than saying it is cheap without saying why.
      expect(reason).toMatch(
        /row|read|cap|bounded|create-only|idempotent|IS metered|no-op|per call/iu
      );
    }
  });

  test("the write handlers that create rows are all metered or bounded by their own rule", () => {
    // A final cross-check with no allowlist in the way. Of the handlers that
    // write to the database, the only unmetered ones must be ones that cannot
    // accumulate state: a hard-capped read is not a write, identity POST is
    // create-only, and so on. This is the shape the reasons above are defending,
    // asserted directly.
    const unmeteredWrites = DISCOVERED.filter(
      (handler) => !isMetered(handler) && handler.method !== "GET"
    ).map(key);
    expect(unmeteredWrites.toSorted()).toEqual([
      "DELETE blocks/[userId]/route.ts",
      "DELETE identity/route.ts",
      "POST blocks/route.ts",
      "POST identity/route.ts",
    ]);
  });
});
