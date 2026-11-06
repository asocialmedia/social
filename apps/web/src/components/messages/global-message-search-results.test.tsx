import { describe, expect, test } from "bun:test";

import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";

import type { GlobalMessageSearchResult } from "@/lib/messages/use-global-message-search";

import { GlobalMessageSearchResults } from "./global-message-search-results";

function renderUnifiedResults(
  messageQueryValid: boolean,
  props: Partial<ComponentProps<typeof GlobalMessageSearchResults>> = {}
): string {
  return renderToString(
    <GlobalMessageSearchResults
      coverageComplete
      coveragePaused={false}
      creatingProfileId={null}
      error={null}
      focusMessageId={null}
      hasMore={false}
      loading={false}
      loadingMore={false}
      messageQueryValid={messageQueryValid}
      myUserId="viewer"
      onLoadMore={() => {}}
      onProfileRetry={() => {}}
      onProfileSelect={() => {}}
      onProfileToggleExpanded={() => {}}
      onRefresh={() => {}}
      onRetry={() => {}}
      onScrollPositionChange={() => {}}
      onSelect={() => {}}
      profileError={null}
      profileExpanded={false}
      profileLoading={false}
      profiles={[]}
      query="needle"
      results={[]}
      restoreScrollTop={0}
      {...props}
    />
  );
}

describe("unified global message search results", () => {
  test("keeps loaded messages available when fetching another page fails", () => {
    const result: GlobalMessageSearchResult = {
      hit: {
        ciphertext: "encrypted",
        conversationAvatarMediaId: null,
        conversationId: "conversation-1",
        conversationName: null,
        conversationType: "DM",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
        id: "message-1",
        iv: "iv",
        keyEpoch: 1,
        peerAvatarUrl: null,
        peerName: "Ada",
        peerUsername: "ada",
        ratchetIndex: 1,
        revision: 1,
        rootKeyCiphertext: null,
        rootKeyIv: null,
        rootKeyWrapperPublicKey: null,
        senderId: "peer",
        senderName: "Ada",
        senderUsername: "ada",
      },
      preview: null,
      previewFailed: true,
    };
    const html = renderUnifiedResults(true, {
      error: "Connection lost.",
      hasMore: true,
      results: [result],
    });
    expect(html).toContain('data-message-id="message-1"');
    expect(html).toContain("Connection lost.");
    expect(html).toContain("Your loaded matches are still available.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Load older results");
  });

  test("keeps message results independent from profile failures", () => {
    const html = renderUnifiedResults(true, {
      profileError: "Profiles could not connect.",
    });
    expect(html).toContain("Profiles could not connect.");
    expect(html).toContain("No messages match “needle”.");
    expect(html).toContain("People you follow");
  });
  test("shows profiles above messages in one results surface", () => {
    const html = renderUnifiedResults(true);

    expect(html.indexOf("Profiles")).toBeLessThan(html.indexOf("Messages"));
    expect(html).toContain("No matching profiles.");
    expect(html).toContain("No messages match “needle”.");
  });

  test("keeps profile results available for a message query that is too short", () => {
    const html = renderUnifiedResults(false);

    expect(html).toContain("No matching profiles.");
    expect(html).toContain("Enter at least two characters to search messages.");
  });
});
