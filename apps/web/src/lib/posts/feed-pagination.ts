// Stop automatic requests after three pages add no new visible posts; the reader can explicitly continue.
export function canAutoContinueFeed<Page>(
  pages: readonly Page[] | undefined,
  items: (page: Page) => readonly { id: string }[],
  visibleIds?: ReadonlySet<string>
): boolean {
  if (!pages || pages.length < 3) {
    return true;
  }
  const known = new Set<string>();
  let emptyTail = 0;
  for (const page of pages) {
    const fresh = items(page).filter(
      (item) => (!visibleIds || visibleIds.has(item.id)) && !known.has(item.id)
    );
    for (const item of fresh) {
      known.add(item.id);
    }
    emptyTail = fresh.length ? 0 : emptyTail + 1;
  }
  return emptyTail < 3;
}

// Sparse pages retain automatic continuation, with backoff instead of a permanent stop.
export function feedContinuationDelay<Page>(
  pages: readonly Page[] | undefined,
  items: (page: Page) => readonly { id: string }[],
  visibleIds?: ReadonlySet<string>
): number {
  return canAutoContinueFeed(pages, items, visibleIds) ? 0 : 2000;
}
