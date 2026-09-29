// The native build's support policy, read once at launch from the server.
//
//   GET /api/mobile/version -> { latest, minimumSupported }
//
// A released build does not update itself, so the app needs an authoritative
// answer to "is the version I am running still served?". The server owns that
// answer because only a release can raise the floor.
//
// A check either COMPLETES (the server was reached and sent a floor, or said it
// has none) or it does not. The second kind is reported as `ok: false` rather
// than as a null floor, and the difference is load-bearing: "the server says
// every build is supported" may lift a gate, while "we never got to ask" may
// not, or a retry after a confirmed retirement would quietly un-retire the
// build and close the gate. See nextSupportState.
//
// The API base is passed in rather than resolved here: this module is fetched
// before anything else on launch, and reading Platform off react-native here
// would make the one path that must never throw depend on the module that
// initialises the app.

import { getWithTimeout } from "@/lib/http-get";

import type { SupportCheck } from "./support-policy";

export interface SupportPolicyOptions {
  apiBase: string;
  baseFetch?: typeof fetch;
}

export async function fetchSupportPolicy(
  options: SupportPolicyOptions
): Promise<SupportCheck> {
  let payload: unknown;
  try {
    const response = await getWithTimeout(
      `${options.apiBase}/api/mobile/version`,
      {},
      { baseFetch: options.baseFetch, timeoutMs: 10_000 }
    );
    if (!response.ok) {
      return { ok: false };
    }
    payload = await response.json();
  } catch {
    return { ok: false };
  }
  if (typeof payload !== "object" || payload === null) {
    // A body we cannot read is not an answer, and must not be treated as an
    // absent floor - that would un-retire a build on a bad gateway.
    return { ok: false };
  }
  const floor = (payload as Record<string, unknown>).minimumSupported;
  return {
    ok: true,
    policy: {
      minimumSupported: typeof floor === "string" ? floor : null,
    },
  };
}
