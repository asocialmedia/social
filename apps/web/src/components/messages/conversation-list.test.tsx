// Rendering tests for ConversationList collapsible sidebar states.
//
// Checks that the expanded sidebar displays the full search bar, new den button,
// and collapse trigger, while the collapsed state displays the rail expand trigger,
// collapsed search icon, and hides the new den button.

import { describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import { ConversationList } from "./conversation-list";
import { MessageIdentityProvider } from "./message-identity-provider";

mock.module("next/navigation", () => ({
  usePathname: () => "/messages",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderList(props: {
  isCollapsed?: boolean;
  layout: "full" | "hidden" | "rail";
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: false,
        retry: false,
      },
    },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MessageIdentityProvider>
        <ConversationList
          activeConversationId={null}
          isCollapsed={props.isCollapsed}
          layout={props.layout}
          onSelect={() => {}}
          onToggleCollapse={() => {}}
        />
      </MessageIdentityProvider>
    </QueryClientProvider>
  );
}

describe("ConversationList collapsible sidebar", () => {
  test("expanded state renders full search bar, new den button, and collapse trigger", () => {
    const html = renderList({ isCollapsed: false, layout: "full" });

    // Header has "Messages" title and collapse trigger
    expect(html).toContain("Messages");
    expect(html).toContain('aria-label="Collapse sidebar"');

    // Search bar is full with input placeholder
    expect(html).toContain('placeholder="Search people you follow…"');
    expect(html).toContain('aria-label="Search people you follow"');

    // New den button is visible
    expect(html).toContain('aria-label="New den"');

    // Tabs are present
    expect(html).toContain('aria-label="Filter conversations"');
    expect(html).toContain("All");
    expect(html).toContain("Dens");
    expect(html).toContain("DMs");
  });

  test("collapsed state renders expand trigger, collapsed search button, and hides new den button and tabs", () => {
    const html = renderList({ isCollapsed: true, layout: "rail" });

    // Header has expand trigger, no visible Messages title
    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html).not.toContain('aria-label="Collapse sidebar"');

    // Search bar is collapsed into an icon button
    expect(html).toContain('aria-label="Search people"');
    expect(html).not.toContain('placeholder="Search people you follow…"');

    // New den button is hidden
    expect(html).not.toContain('aria-label="New den"');

    // Tabs are hidden
    expect(html).not.toContain('aria-label="Filter conversations"');
  });

  test("hidden layout renders nothing", () => {
    const html = renderList({ layout: "hidden" });
    expect(html).toBe("");
  });
});
