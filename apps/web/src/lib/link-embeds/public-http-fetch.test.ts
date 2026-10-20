// The connector's callback boundary is tested directly before the live rebinding check.
// oxlint-disable promise/prefer-await-to-callbacks
import { expect, mock, test } from "bun:test";
import type { LookupAddress, LookupOptions } from "node:dns";

let answers: LookupAddress[] = [{ address: "93.184.216.34", family: 4 }];
let lookups = 0;
mock.module("node:dns/promises", () => ({
  lookup: () => {
    lookups += 1;
    return Promise.resolve(answers);
  },
}));

const { createPublicLookup, fetchPublicUrl } =
  await import("./public-http-fetch");

function connectAddress(records: LookupAddress[], options?: LookupOptions) {
  const resolve = mock(() => Promise.resolve(records));
  const pending = Promise.withResolvers<string | LookupAddress[]>();
  createPublicLookup(resolve)(
    "public.example",
    options ?? { all: true },
    (error, address) => {
      if (error) {
        pending.reject(error);
      } else {
        pending.resolve(address);
      }
    }
  );
  return { resolve, result: pending.promise };
}

test.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "::1",
  "::ffff:127.0.0.1",
])(
  "socket DNS rejects private answer %s even alongside a public address",
  async (address) => {
    const { result } = connectAddress([
      { address: "93.184.216.34", family: 4 },
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await expect(result).rejects.toThrow("exclusively to public");
  }
);

test("the connector receives the validated addresses without a second resolution", async () => {
  const records = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ];
  const { result, resolve } = connectAddress(records);
  expect(await result).toEqual(records);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(await connectAddress(records, { family: 6 }).result).toBe(
    records[1]?.address ?? ""
  );
  await expect(connectAddress([]).result).rejects.toThrow(
    "exclusively to public"
  );
});

test("a public preflight that rebinds to loopback never reaches the private HTTP server", async () => {
  let hits = 0;
  const server = Bun.serve({
    fetch: () => {
      hits += 1;
      return new Response("private");
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    answers = [{ address: "93.184.216.34", family: 4 }];
    const { lookup } = await import("node:dns/promises");
    expect(await lookup("rebinding.example", { all: true })).toEqual(answers);
    answers = [{ address: "127.0.0.1", family: 4 }];
    lookups = 0;
    await expect(
      fetchPublicUrl(
        new URL(`http://rebinding.example:${server.port}/secret`),
        { headers: {}, redirect: "manual", signal: AbortSignal.timeout(2000) }
      )
    ).rejects.toThrow();
    expect(lookups).toBeGreaterThan(0);
    expect(hits).toBe(0);
  } finally {
    server.stop(true);
  }
});
