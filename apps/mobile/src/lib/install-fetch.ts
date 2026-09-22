// Installs the install-token interceptor on global fetch.
//
// better-auth builds its own requests internally, so wrapping global fetch once
// at startup is the only place that covers every caller - including libraries
// we do not control. Scoped to our own origin so the credential never reaches
// another host.

import { peekInstallToken } from "./install-credentials";
import { createInstallFetch } from "./install-token";

let installed = false;

/** Installs the interceptor. Idempotent, so it is safe to call on every render. */
export function installFetchInterceptor(origin: string): void {
  if (installed) {
    return;
  }
  installed = true;
  const baseFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = createInstallFetch({
    baseFetch,
    getToken: peekInstallToken,
    origin,
  }) as typeof globalThis.fetch;
}
