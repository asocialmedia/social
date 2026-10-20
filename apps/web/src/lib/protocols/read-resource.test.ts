import { expect, test } from "bun:test";

import { readProtocolResource } from "./read-resource";

const signal = () => AbortSignal.timeout(10_000);
test("a cold profile read recovers automatically from a temporary failure", async () => {
  let calls = 0;
  const delays: number[] = [];
  const profile = await readProtocolResource(
    "/api/protocols/bluesky/profile?actor=bsky.app",
    signal(),
    {
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? Response.json(
                { error: "Unavailable" },
                { headers: { "retry-after": "2" }, status: 503 }
              )
            : Response.json({ id: "did:plc:profile" })
        );
      },
      wait: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    }
  );
  expect(profile).toEqual({ id: "did:plc:profile" });
  expect(calls).toBe(2);
  expect(delays).toEqual([2000]);
});

test.each([400, 401, 403, 404, 410])(
  "permanent %i resource outcomes do not loop",
  async (status) => {
    let calls = 0;
    await expect(
      readProtocolResource("/profile", signal(), {
        fetch: () => {
          calls += 1;
          return Promise.resolve(new Response(null, { status }));
        },
      })
    ).rejects.toMatchObject({ status });
    expect(calls).toBe(1);
  }
);

test("temporary outages stop after three attempts and cancellation never retries", async () => {
  let calls = 0;
  await expect(
    readProtocolResource("/profile", signal(), {
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response(null, { status: 503 }));
      },
      wait: () => Promise.resolve(),
    })
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(3);
  const controller = new AbortController();
  controller.abort();
  await expect(
    readProtocolResource("/profile", controller.signal, {
      fetch: () => {
        calls += 1;
        return Promise.resolve(Response.json({}));
      },
    })
  ).rejects.toBeDefined();
  expect(calls).toBe(3);
});
