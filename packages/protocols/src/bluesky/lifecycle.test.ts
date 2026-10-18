import { expect, test } from "bun:test";

import { readBlueskyAccountStatus } from "./lifecycle";

const did = "did:plc:z72i7hdynmk6r22z27h6tvur";
for (const status of [
  "deleted",
  "deactivated",
  "takendown",
  "suspended",
  "desynchronized",
  "throttled",
] as const) {
  test(`keeps explicit ${status} separate from deletion`, async () => {
    expect(
      await readBlueskyAccountStatus(
        did,
        AbortSignal.timeout(1000),
        (input) => {
          expect(String(input)).toBe(
            `https://bsky.network/xrpc/com.atproto.sync.getRepoStatus?did=${encodeURIComponent(did)}`
          );
          return Promise.resolve(Response.json({ active: false, did, status }));
        }
      )
    ).toBe(status);
  });
}
test("active takes precedence over a stale status and unknown failures never become deleted", async () => {
  for (const body of [
    { active: true, did, status: "deleted" },
    { active: false, did },
    { active: false, did: "did:web:different.test", status: "deleted" },
    { active: false, did, status: "new-unknown-status" },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each response validates a distinct lifecycle condition.
    const result = await readBlueskyAccountStatus(
      did,
      AbortSignal.timeout(1000),
      () => Promise.resolve(Response.json(body))
    );
    expect(result).toBe(body.active ? "active" : "unknown");
  }
  expect(
    await readBlueskyAccountStatus(did, AbortSignal.timeout(1000), () =>
      Promise.resolve(Response.json({ error: "RepoNotFound" }, { status: 400 }))
    )
  ).toBe("unknown");
  expect(
    await readBlueskyAccountStatus(did, AbortSignal.timeout(1000), () =>
      Promise.reject(new Error("offline"))
    )
  ).toBe("unknown");
});
