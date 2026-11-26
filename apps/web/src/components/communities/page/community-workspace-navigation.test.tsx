import { expect, test } from "bun:test";

import { Dialog } from "@asm/ui/shadui/dialog";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  communitySectionScope,
  useCommunitySectionStore,
} from "@/store/community-section-store";

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
  expect(html).toContain("transition-[width]");
  expect(html).toContain("motion-reduce:transition-none");
  expect(html).toContain("sidebar-icon-hover");
  expect(html).toContain("chip-3d-raised");
  expect(html.match(/fill-current/g)).toHaveLength(1);
  expect(html).not.toContain("Channel contents");
});

test("expanded navigation presents channels and a collapse action in the desktop layout", () => {
  const scope = communitySectionScope(undefined, common.slug);
  const { locations, remember } = useCommunitySectionStore.getState();
  remember(scope, { chatHref: "/a/table/chat/announcements" });
  try {
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
    expect(html).toContain("Dens");
    expect(html).toContain("segmented-3d");
    expect(html).toContain("community-section-selector");
    expect(html).toContain("chip-3d-raised");
    expect(html).toContain('data-active-section="posts"');
    expect(html).toContain("stroke-background");
    expect(html.match(/fill-current/g)).toHaveLength(1);
    expect(html).toContain('data-state="active"');
    expect(html).not.toContain('href="/a/table/chat/announcements"');
    expect(html).toContain("Channel contents");
    expect(html).toContain("w-64");
  } finally {
    useCommunitySectionStore.setState({ locations });
  }
});

test("chat header keeps thread back navigation, the sidebar toggle and the More dialog trigger", () => {
  const html = renderToStaticMarkup(
    <Dialog>
      <CommunityConversationHeader
        {...common}
        browseButtonRef={createRef()}
        channelId="general"
        channelName="Studio"
        channelsOpen={false}
        onBrowse={() => {}}
        reconnecting={false}
        thread
      />
    </Dialog>
  );
  expect(html).toContain('aria-label="Back to channel"');
  expect(html).toContain('href="/a/table/chat/general"');
  expect(html).toContain('aria-label="Toggle community sidebar"');
  expect(html).toContain('aria-controls="community-workspace-navigation"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="Conversation details and tools"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('aria-label="table community sections"');
});

test("Posts separates sort links from channels and points Dens directly at the default room", () => {
  const html = renderToStaticMarkup(
    <CommunityWorkspaceNavigation
      {...common}
      active="posts"
      desktop
      globalChatHref="/a/table/chat/general"
      navigation={<h2>Channels</h2>}
      onOpenChange={() => {}}
      open
      postsSearchParams="type=images&sort=top&cursor=old"
      triggerRef={createRef()}
    />
  );
  expect(html).toContain('href="/a/table/chat/general"');
  const sorting = html.match(
    /<nav aria-label="Post sorting"[\s\S]+?<\/nav>/
  )?.[0];
  expect(sorting).toContain('href="/a/table?type=images"');
  expect(sorting).toMatch(
    /aria-current="page"[^>]*href="\/a\/table\?type=images&amp;sort=top"/
  );
  expect(sorting).not.toContain("cursor=");
  expect(sorting).not.toContain("Channels");
});

test("Posts exposes its drawer and a single labelled chat icon", () => {
  const html = renderToStaticMarkup(
    <CommunitySectionNav
      accentColor="forest"
      slug="table"
      navigationOpen={false}
      onOpenNavigation={() => {}}
      navigationTriggerRef={createRef()}
    />
  );
  expect(html).toContain('aria-label="Open community sidebar"');
  expect(html).toContain('href="/a/table/chat"');
  expect(html).not.toContain('href="/a/table"');
  expect(html).toContain('aria-label="Open community Dens"');
  expect(html).not.toContain(">Chat<");
});

test("compact Posts identity shares its section bar with the sidebar and direct Chat link", () => {
  const html = renderToStaticMarkup(
    <CommunitySectionNav
      accentColor="forest"
      slug="table"
      identity={<span aria-hidden="true">The Open Table · a/table</span>}
      navigationOpen
      onOpenNavigation={() => {}}
      navigationTriggerRef={createRef()}
    />
  );
  expect(html).toContain("The Open Table · a/table");
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-controls="community-workspace-navigation"');
  expect(html).not.toContain('href="/a/table"');
  expect(html).toContain('href="/a/table/chat"');
  expect(html.match(/<nav\b/g)).toHaveLength(1);
});
