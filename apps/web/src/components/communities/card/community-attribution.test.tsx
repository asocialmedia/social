import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  CommunityAttribution,
  CommunityShareCard,
} from "./community-attribution";

const community = {
  accentColor: "ember",
  id: "community-id",
  name: "asocialmedia",
  slug: "asocialmedia",
};

describe("community attribution", () => {
  test("shows the avatar and a complete attribution while keeping the community link", () => {
    const html = renderToStaticMarkup(
      <CommunityAttribution
        community={community}
        reason="Trending in a/asocialmedia"
      />
    );
    expect(html).toContain("Shared via ");
    expect(html).toContain('href="/a/asocialmedia"');
    expect(html).toContain("/api/communities/avatar/community-id/image");
    expect(html).toContain("asocialmedia community");
    expect(html).toContain("Trending in a/asocialmedia");
    expect(html).not.toContain("community-accent-rail");
  });

  test("keeps the reshare linked to its source and uses the same avatar attribution", () => {
    const html = renderToStaticMarkup(
      <CommunityShareCard community={community} sourcePostId="post-source" />
    );
    expect(html).toContain("Shared via a/asocialmedia");
    expect(html).toContain("/api/communities/avatar/community-id/image");
    expect(html).toContain("/a/asocialmedia/posts/");
    expect(html).not.toContain("community-accent-rail");
  });
});
