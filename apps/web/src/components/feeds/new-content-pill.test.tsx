import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import { NewContentPill } from "./new-content-pill";

const handleClick = () => true;

describe("NewContentPill", () => {
  test("renders the count and poster avatars for new content", () => {
    const html = renderToString(
      <NewContentPill
        authors={[
          { avatarUrl: "/avatars/alice.png", id: "alice" },
          { avatarUrl: "/avatars/bob.png", id: "bob" },
        ]}
        count={2}
        noun="post"
        onClick={handleClick}
      />
    );

    expect(html).toContain("2 new posts");
    expect(html).toContain('aria-label="Show 2 new posts"');
    expect(html).toContain("alice.png");
    expect(html).toContain("bob.png");
  });

  test("does not render when there is no new content", () => {
    const html = renderToString(
      <NewContentPill
        authors={[]}
        count={0}
        noun="gust"
        onClick={handleClick}
      />
    );

    expect(html).toBe("");
  });
});
