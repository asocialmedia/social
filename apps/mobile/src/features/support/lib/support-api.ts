// The native build's support policy, read once at launch from the server.
//
//   GET /api/mobile/version -> { latest, minimumSupported }
//
// A released build does not update itself, so the app needs an authoritative
// answer to "is the version I am running still served?". The server owns that
// answer because only a release can raise the floor. An unreadable or failed
// answer is NOT a retirement: it returns null, which the policy reads as "no
// floor", so an offline launch or a bad gateway can never lock anyone out.
//
// The API base is passed in rather than resolved here: this module is fetched
// before anything else on launch, and reading Platform off react-native here
// would make the one path that must never throw depend on the module that
// initialises the app.

import { getWithTimeout } from "@/lib/http-get";

import type { SupportPolicy } from "./support-policy";

export interface SupportPolicyOptions {
  apiBase: string;
  baseFetch?: typeof fetch;
}

export async function fetchSupportPolicy(
  options: SupportPolicyOptions
): Promise<SupportPolicy> {
  const response = await getWithTimeout(
    `${options.apiBase}/api/mobile/version`,
    {},
    { baseFetch: options.baseFetch, timeoutMs: 10_000 }
  );
  if (!response.ok) {
    return { minimumSupported: null };
  }
  const payload: unknown = await response.json();
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const floor = record.minimumSupported;
  return { minimumSupported: typeof floor === "string" ? floor : null };
}
