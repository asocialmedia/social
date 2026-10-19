import { expect, test } from "bun:test";

import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CommunityConversationHeader from "./community-conversation-header";
import CommunitySectionNav from "./community-section-nav";
import CommunityWorkspaceNavigation from "./community-workspace-navigation";

const common = {
  accentColor: "forest",
  avatarUrl: null,
  communityName: "The Open Table",
  slug: "table",
};

test("the collapsed rail links Posts and the current chat without mounting channels", () => {
  const html = renderToStaticMarkup(
    <CommunityWorkspaceNavigation
      {...common}
      active="chat"
      channelId="general"
      desktop
      navigation={<div>Channel contents</div>}
      open={false}
      onOpenChange={() => {}}
      triggerRef={createRef()}
    />
  );
  expect(html).toContain('href="/a/table"');
  expect(html).toContain('href="/a/table/chat/general"');
  expect(html).toContain('aria-label="Expand community sidebar"');
  expect(html).toContain('aria-label="Show community channels"');
  expect(html).not.toContain("Channel contents");
});

test("expanded navigation presents channels and a collapse action in the desktop layout", () => {
  const html = renderToStaticMarkup(
    <CommunityWorkspaceNavigation
      {...common}
      active="posts"
      desktop
      navigation={<div>Channel contents</div>}
      open
      onOpenChange={() => {}}
      triggerRef={createRef()}
    />
  );
  expect(html).toContain('aria-label="Collapse community sidebar"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('href="/a/table/chat"');
  expect(html).toContain("Channel contents");
  expect(html).toContain("w-64");
});

test("chat header keeps thread back navigation and provides an explicit mobile drawer control", () => {
  const html = renderToStaticMarkup(
    <CommunityConversationHeader
      {...common}
      browseButtonRef={createRef()}
      channelId="general"
      channelName="Studio"
      channelsOpen={false}
      onBrowse={() => {}}
      onTools={() => {}}
      reconnecting={false}
      thread
    />
  );
  expect(html).toContain('aria-label="Back to channel"');
  expect(html).toContain('href="/a/table/chat/general"');
  expect(html).toContain('aria-label="Toggle community sidebar"');
  expect(html).toContain('aria-controls="community-workspace-navigation"');
  expect(html).toContain('aria-expanded="false"');
});

test("Posts exposes the same drawer without removing its direct section tabs", () => {
  const html = renderToStaticMarkup(
    <CommunitySectionNav
      accentColor="forest"
      active="posts"
      slug="table"
      navigationOpen={false}
      onOpenNavigation={() => {}}
      navigationTriggerRef={createRef()}
    />
  );
  expect(html).toContain('aria-label="Open community sidebar"');
  expect(html).toContain('href="/a/table/chat"');
  expect(html).toContain('href="/a/table"');
});
