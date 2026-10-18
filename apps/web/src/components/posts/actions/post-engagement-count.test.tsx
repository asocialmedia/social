import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { PostEngagementCount } from "./post-engagement-count";

test("Bluesky uses source likes and a heart instead of the local amplification count", () => {
  const html = renderToStaticMarkup(
    <PostEngagementCount aura={999} likeCount={1234} />
  );
  expect(html).toContain('aria-label="Likes on Bluesky: 1234"');
  expect(html).toContain("lucide-heart");
  expect(html).not.toContain("lucide-flame");
  expect(html).not.toContain("999");
  expect(html).not.toContain('title="Aura"');
});

test("zero source likes stays zero and missing source counts do not invent Aura", () => {
  const zero = renderToStaticMarkup(
    <PostEngagementCount aura={999} likeCount={0} />
  );
  expect(zero).toContain('aria-label="Likes on Bluesky: 0"');
  expect(zero).not.toContain("999");
  const unavailable = renderToStaticMarkup(
    <PostEngagementCount aura={999} likeCount={null} />
  );
  expect(unavailable).toContain("Likes on Bluesky unavailable");
  expect(unavailable).toContain("—");
  expect(unavailable).not.toContain("999");
});

test("native ASM posts retain Aura and the flame", () => {
  const html = renderToStaticMarkup(<PostEngagementCount aura={42} />);
  expect(html).toContain('aria-label="Aura: 42"');
  expect(html).toContain("lucide-flame");
  expect(html).not.toContain("lucide-heart");
});
