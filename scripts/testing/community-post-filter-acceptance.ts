import assert from "node:assert/strict";

import type { PostsPage } from "@asm/db";

const origin = "http://localhost:3000";
const base = `${origin}/api/communities/community-chat-playground/posts`;
const results: { name: string; passed: boolean; error?: string }[] = [];

async function page(query: Record<string, string> = {}) {
  const response = await fetch(`${base}?${new URLSearchParams(query)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  const data = (await response.json()) as PostsPage;
  assert.ok(Array.isArray(data.posts));
  assert.ok(data.posts.length <= 20);
  return data;
}

const cases: { name: string; run: () => Promise<void> }[] = [
  {
    name: "combined link, date, keyword and author filters return the seeded post",
    run: async () => {
      const data = await page({
        type: "links",
        range: "week",
        q: "A few colors from this morning",
        author: "@ANNY",
        rating: "safe",
      });
      assert.deepEqual(
        data.posts.map((post) => post.id),
        ["ccp_post_morning_colors"]
      );
    },
  },
  {
    name: "Top preserves all active filters",
    run: async () => {
      const data = await page({
        sort: "top",
        type: "links",
        q: "textures for the next collage",
        author: "communitychat_mod",
      });
      assert.deepEqual(
        data.posts.map((post) => post.id),
        ["ccp_post_texture_walk"]
      );
    },
  },
  {
    name: "image upload filters do not misclassify external link preview images",
    run: async () => {
      const data = await page({
        type: "images",
        q: "A few colors from this morning",
      });
      assert.equal(data.posts.length, 0);
    },
  },
  {
    name: "rating filter narrows results and literal wildcards are escaped",
    run: async () => {
      const [explicit, literal] = await Promise.all([
        page({ rating: "explicit", q: "A few colors from this morning" }),
        page({ q: "%_literal_no_fixture" }),
      ]);
      assert.equal(explicit.posts.length, 0);
      assert.equal(literal.posts.length, 0);
    },
  },
  {
    name: "an excluded cursor cannot shift the filtered page",
    run: async () => {
      const data = await page({
        q: "A few colors from this morning",
        cursor: "ccp_post_texture_walk",
      });
      assert.deepEqual(
        data.posts.map((post) => post.id),
        ["ccp_post_morning_colors"]
      );
    },
  },
  {
    name: "unknown filter values normalize to the default feed",
    run: async () => {
      const [normal, invalid] = await Promise.all([
        page(),
        page({
          type: "invalid",
          range: "invalid",
          rating: "invalid",
          sort: "invalid",
        }),
      ]);
      assert.deepEqual(
        invalid.posts.map((post) => post.id),
        normal.posts.map((post) => post.id)
      );
    },
  },
];

for (const scenario of cases) {
  try {
    // oxlint-disable-next-line no-await-in-loop -- Keep HTTP acceptance scenarios sequential to bound local service traffic.
    await scenario.run();
    results.push({ name: scenario.name, passed: true });
    console.log(`PASS ${scenario.name}`);
  } catch (error) {
    results.push({
      name: scenario.name,
      passed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    console.log(`FAIL ${scenario.name}`);
  }
}
const failed = results.filter((result) => !result.passed).length;
await Bun.write(
  "audits/community-post-filter-acceptance.json",
  JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      origin,
      passed: results.length - failed,
      failed,
      results,
    },
    null,
    2
  ) + "\n"
);
process.exitCode = failed ? 1 : 0;
