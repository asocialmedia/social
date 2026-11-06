import { expect, test } from "bun:test";

import type { CommunityData } from "@asm/db";
import { renderToString } from "react-dom/server";

import { CommunityChatShortcut } from "./community-chat-strip";

const community: CommunityData = {
  _count: { members: 4, posts: 2 },
  accentColor: "#f97316",
  avatarUrl: null,
  bannerUrl: null,
  createdAt: new Date(),
  description: "A place to talk",
  id: "community-1",
  mature: false,
  name: "The Open Table",
  ownerId: "owner",
  slug: "open-table",
  topics: [],
  type: "PUBLIC",
  updatedAt: new Date(),
};

test("touch shortcut exposes a named, expandable preview and accessible unread state", () => {
  const html = renderToString(
    <CommunityChatShortcut entry={{ community, hasUnread: true }} />
  );
  expect(html).toContain('aria-label="The Open Table, unread messages"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('type="button"');
  expect(html).not.toContain('href="/a/open-table/chat"');
});

test("read communities do not announce unread messages", () => {
  const html = renderToString(
    <CommunityChatShortcut entry={{ community, hasUnread: false }} />
  );
  expect(html).toContain('aria-label="The Open Table"');
  expect(html).not.toContain("unread messages");
});

test("fine-pointer shortcut is a direct chat link with a hover preview", () => {
  const html = renderToString(
    <CommunityChatShortcut
      entry={{ community, hasUnread: true }}
      hoverCapable
    />
  );
  expect(html).toContain('href="/a/open-table/chat"');
  expect(html).toContain('aria-label="The Open Table, unread messages"');
  expect(html).not.toContain('aria-haspopup="dialog"');
});
