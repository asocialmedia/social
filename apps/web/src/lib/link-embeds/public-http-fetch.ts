// Node's socket lookup API requires promise-to-callback adaptation.
// oxlint-disable promise/prefer-await-to-callbacks, promise/prefer-await-to-then, promise/no-callback-in-promise
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";

// Use the package transport; Bun's built-in undici shim does not apply custom dispatchers.
import { Agent, fetch as dispatchFetch } from "undici/index.js";

import { isPrivateOrReservedHost } from "./shared";

// Validate the address passed to the socket, closing the gap between URL preflight and fetch DNS resolution.
export function createPublicLookup(
  resolve: (
    hostname: string,
    options: { all: true; verbatim: true }
  ) => Promise<LookupAddress[]> = lookup
): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname, { all: true, verbatim: true }).then(
      (records) => {
        if (
          !records.length ||
          records.some((record) => isPrivateOrReservedHost(record.address))
        ) {
          callback(
            new Error(
              "Link target does not resolve exclusively to public addresses"
            ),
            "",
            0
          );
          return;
        }
        const matching = records.filter(
          (record) => !options.family || record.family === options.family
        );
        if (!matching.length) {
          callback(
            new Error("No public address matches the requested family"),
            "",
            0
          );
          return;
        }
        if (options.all) {
          return callback(null, matching);
        }
        const [first] = matching;
        if (first) {
          return callback(null, first.address, first.family);
        }
      },
      (error: unknown) =>
        callback(
          error instanceof Error
            ? error
            : new Error("Link target DNS lookup failed"),
          "",
          0
        )
    );
  };
}

const publicDispatcher = new Agent({
  bodyTimeout: 4000,
  connect: { lookup: createPublicLookup(), timeout: 4000 },
  connections: 4,
  headersTimeout: 4000,
  keepAliveMaxTimeout: 4000,
  keepAliveTimeout: 1000,
});

export function fetchPublicUrl(
  url: URL,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: "manual";
  }
) {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    isPrivateOrReservedHost(url.hostname)
  ) {
    throw new Error("Private link targets are not allowed");
  }
  return dispatchFetch(url, { ...init, dispatcher: publicDispatcher });
}
