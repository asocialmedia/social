import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MessageSearchResults } from "./message-search-results";

describe("MessageSearchResults server scope", () => {
  test("shows a settled empty state independently of transcript history loading", () => {
    const markup = renderToStaticMarkup(
      <MessageSearchResults
        activeIndex={0}
        allMessages={[]}
        coverageUnavailable={false}
        indexingOlder={false}
        listPageError={null}
        listPageLoading={false}
        listPageStale={false}
        members={[]}
        myUserId="user-1"
        onJump={() => {}}
        pageHitIds={[]}
        query="needle"
        results={[]}
        savedScope={false}
        totalMatches={0}
        truncated={false}
      />
    );

    expect(markup).toContain("No messages match this search.");
  });
});
