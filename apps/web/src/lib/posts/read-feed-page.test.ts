import { expect, test } from "bun:test";

import { readFeedPage } from "./read-feed-page";

test("an expired Home or Explore snapshot resumes with its loaded posts retained", async () => {
  const cursors: (string | null)[] = [];
  const page = await readFeedPage<{
    posts: { id: string }[];
    nextCursor: string;
  }>(
    (cursor) => {
      cursors.push(cursor);
      return Promise.resolve(
        cursor
          ? new Response(null, { status: 410 })
          : Response.json({
              nextCursor: "replacement",
              posts: [{ id: "loaded" }, { id: "new" }],
            })
      );
    },
    "expired",
    new Set(["loaded"])
  );
  expect(cursors).toEqual(["expired", null]);
  expect(page).toEqual({ nextCursor: "replacement", posts: [{ id: "new" }] });
});

test("continuation outages remain retryable and do not masquerade as an empty end", async () => {
  await expect(
    readFeedPage(
      () =>
        Promise.resolve(
          new Response(null, { headers: { "retry-after": "3" }, status: 503 })
        ),
      "valid",
      new Set()
    )
  ).rejects.toMatchObject({ retryAfter: 3000, status: 503 });
});

test("a normal continuation keeps its cursor and data", async () => {
  expect(
    await readFeedPage(
      () =>
        Promise.resolve(
          Response.json({ nextCursor: "next", posts: [{ id: "post" }] })
        ),
      "cursor",
      new Set()
    )
  ).toEqual({ nextCursor: "next", posts: [{ id: "post" }] });
});
