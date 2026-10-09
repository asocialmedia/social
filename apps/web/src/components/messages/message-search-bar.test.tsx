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
      totalResults: 7,
    });

    expect(markup).toContain("Searching older messages…");
    expect(markup).not.toContain("7 results");
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

    expect(markup).toContain("Offline — searching saved messages");
    expect(markup).not.toContain("No matching messages");
  });
});
