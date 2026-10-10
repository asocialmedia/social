// A probe for the conversation-route limiters, for route tests that mock the
// rules module.
//
// The reason this exists rather than each test hand-rolling it: the conversation
// routes import `consumeDenRateLimit` from `@/lib/messages/den-rate-limit`, and
// bun's `mock.module` does NOT reliably reach that module's own binding on
// `@asm/db`. Without an explicit mock of the rules module, a route test silently
// spends real budget in the shared Redis instance the dev and test stacks point
// at, which makes the suite order-dependent and eventually starts answering 429
// to a test that is only trying to check a 200. The den route tests have mocked
// this module all along; the DM-era conversation routes have not, because until
// now they had no limiter of their own to mock.
//
// One probe per test file, so a test can say WHICH bucket an operation spends
// (not merely that a limiter was consulted), which account it was charged to,
// whether the limiter is refusing, and - through `order` - that the limiter ran
// before the work it is there to protect.
import type { DenRateLimitRule } from "../den-rate-limit";
import {
  denRateLimitDouble,
  rateLimitedResponse,
} from "./den-rate-limit-double";

export interface MessageRouteLimiter {
  // Every bucket charged since the last reset, in order. Two entries means two
  // buckets were consulted, which is how the send route's two-tier budget is
  // asserted rather than assumed.
  chargedBuckets: string[];
  // The identifier each charge was made against, in the same order. This is how
  // "metered per account, not per conversation and not per IP" is checked.
  chargedIdentifiers: string[];
  denied: () => boolean;
  // Refuse one named bucket and allow the rest, which is how a test isolates the
  // second budget of a two-tier limiter instead of denying both at once.
  setDeniedBucket: (bucket: string | null) => void;
  // Interleaved log of limiter charges and service calls, as `consume:<bucket>`
  // and `service:<name>`. The ordering tests read this.
  order: string[];
  // The module a test hands to `mock.module`.
  module: Record<string, unknown>;
  reset: () => void;
  // Called from inside a test's service mock, so the log can say the work ran.
  service: (name: string) => void;
  setDenied: (denied: boolean) => void;
}

export function messageRouteLimiter(
  retryAfterSeconds = 42
): MessageRouteLimiter {
  const chargedBuckets: string[] = [];
  const chargedIdentifiers: string[] = [];
  const order: string[] = [];
  let denied = false;
  let deniedBucket: string | null = null;
  // A plain function rather than `mock()`: this module is not a `.test.ts` file
  // and so IS type-checked, and the call record the tests assert on is these two
  // arrays rather than bun's own. Nothing here needs mock's extra machinery.
  const consume = (
    rule: DenRateLimitRule,
    identifier: string
  ): Promise<Response | null> => {
    chargedBuckets.push(rule.bucket);
    chargedIdentifiers.push(identifier);
    order.push(`consume:${rule.bucket}`);
    const refused = denied || rule.bucket === deniedBucket;
    return Promise.resolve(
      refused ? rateLimitedResponse(retryAfterSeconds) : null
    );
  };
  return {
    chargedBuckets,
    chargedIdentifiers,
    denied: () => denied,
    module: denRateLimitDouble(consume),
    order,
    reset: () => {
      chargedBuckets.length = 0;
      chargedIdentifiers.length = 0;
      order.length = 0;
      denied = false;
      deniedBucket = null;
    },
    service: (name: string) => {
      order.push(`service:${name}`);
    },
    setDenied: (value: boolean) => {
      denied = value;
    },
    setDeniedBucket: (bucket: string | null) => {
      deniedBucket = bucket;
    },
  };
}
