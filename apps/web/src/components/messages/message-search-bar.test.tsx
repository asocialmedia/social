import { describe, expect, test } from "bun:test";

import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageSearchBar } from "./message-search-bar";
import type { MessageSearchBarProps } from "./message-search-bar";

function renderSearchBar(
  overrides: Partial<MessageSearchBarProps> = {}
): string {
  const props: MessageSearchBarProps = {
    activePosition: 0,
    fullyCovered: false,
    indexFailed: false,
    indexing: false,
    indexingOlder: false,
    inputRef: createRef<HTMLInputElement>(),
    jumpError: null,
    listPageError: null,
    listPageStale: false,
    matchCount: 0,
    onClose: () => {},
    onNext: () => {},
    onPage: () => {},
    onPrevious: () => {},
    onQueryChange: () => {},
    onRetrySearch: () => {},
    onSubmit: () => {},
    onToggleView: () => {},
    page: 0,
    pageCount: 1,
    query: "needle",
    rangeEnd: 0,
    rangeStart: 0,
    resultCount: 0,
    storageFull: false,
    totalResults: 0,
    view: "chat",
    ...overrides,
  };
  return renderToStaticMarkup(<MessageSearchBar {...props} />);
}

describe("MessageSearchBar user-facing fallback states", () => {
  test("names saved-history scope during an online service fallback without declaring the device offline", () => {
    const markup = renderSearchBar({
      fullyCovered: true,
      savedHistorySearch: true,
      serverManaged: true,
    });
    expect(markup).toContain(
      "Full search unavailable — showing saved messages"
    );
    expect(markup).not.toContain("Offline");
    expect(markup).not.toContain("No matching messages");
    expect(markup).not.toContain("Searching older messages");
  });
  test("shows incomplete history without manual indexing or technical counters", () => {
    const markup = renderSearchBar();

    expect(markup).toContain("Searching older messages…");
    expect(markup).not.toContain("Index older messages");
    expect(markup).not.toContain("indexed");
    expect(markup).not.toContain("Storage full");
  });

  test("shows a plain retry action when local search cannot finish", () => {
    const markup = renderSearchBar({ indexFailed: true });

    expect(markup).toContain("Search couldn&#x27;t finish");
    expect(markup).toContain(">Retry</button>");
    expect(markup).not.toContain("Retry indexing");
  });

  test("shows a storage failure instead of incomplete-history progress", () => {
    const markup = renderSearchBar({ storageFull: true });

    expect(markup).toContain("Search couldn&#x27;t finish");
    expect(markup).not.toContain("Searching older messages…</span>");
  });

  test("keeps partial hits visible while naming incomplete server coverage", () => {
    const markup = renderSearchBar({
      indexingOlder: true,
      matchCount: 7,
      resultCount: 7,
      searchHasMore: false,
      serverManaged: true,
      totalMatchesExact: false,
      totalResults: 7,
    });

    expect(markup).toContain("1 of 7 found so far");
    expect(markup).toContain("Searching older messages…");
  });

  test("shows an exact result count without an uncertainty suffix", () => {
    const markup = renderSearchBar({
      fullyCovered: true,
      matchCount: 7,
      resultCount: 7,
      serverManaged: true,
      totalMatchesExact: true,
      totalResults: 7,
    });

    expect(markup).toContain("1 of 7");
    expect(markup).not.toContain("of at least");
    expect(markup).not.toContain("7+");
  });

  test("keeps jump failures visible and retryable beside existing matches", () => {
    const markup = renderSearchBar({
      activePosition: 1,
      jumpError: "This message is no longer available.",
      matchCount: 5,
      onRetryJump: () => {},
      serverManaged: true,
      totalMatchesExact: true,
      totalResults: 5,
    });

    expect(markup).toContain("This message is no longer available.");
    expect(markup).toContain("Retry message");
    expect(markup).not.toContain("1 of 5");
  });

  test("does not claim a result range while an empty page is loading", () => {
    const markup = renderSearchBar({
      listPageLoading: true,
      matchCount: 29,
      page: 1,
      rangeEnd: 40,
      rangeStart: 21,
      resultCount: 0,
      serverManaged: true,
      totalMatchesExact: true,
      totalResults: 29,
      view: "list",
    });

    expect(markup).toContain("Loading results…");
    expect(markup).not.toContain("21–40");
  });

  test("shows the exact localized total in list mode", () => {
    const markup = renderSearchBar({
      fullyCovered: true,
      page: 0,
      pageCount: 264,
      rangeEnd: 20,
      rangeStart: 1,
      resultCount: 20,
      serverManaged: true,
      totalMatchesExact: true,
      totalResults: 5274,
      view: "list",
    });

    expect(markup).toContain(`1–20 of ${new Intl.NumberFormat().format(5274)}`);
    expect(markup).toContain("Page 1 of 264");
  });

  test("rejects a single emoji using the shared Unicode minimum", () => {
    const markup = renderSearchBar({
      fullyCovered: true,
      query: "😀",
      serverManaged: true,
      totalMatchesExact: true,
    });

    expect(markup).not.toContain("No matching messages");
    expect(markup).not.toContain("No matching saved messages");
  });

  test("stops the older-history state when settled history has unreadable messages", () => {
    const markup = renderSearchBar({
      coverageUnavailable: true,
      serverManaged: true,
    });

    expect(markup).toContain("Some older messages couldn&#x27;t be searched");
    expect(markup).not.toContain("Searching older messages…");
    expect(markup).not.toContain("No matching messages");
  });

  test("keeps offline scope visible when saved history has no matching messages", () => {
    const markup = renderSearchBar({
      offlineSearch: true,
      serverManaged: true,
      totalResults: 0,
    });

    expect(markup).toContain("Offline — saved messages only");
    expect(markup).not.toContain("No matching messages");
  });
});
