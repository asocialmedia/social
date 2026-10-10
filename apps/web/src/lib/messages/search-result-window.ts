export const MAX_RETAINED_SEARCH_PAGES = 3;

export interface SearchResultPageBoundary {
  nextCursor: string | null;
  previousCursor: string | null;
  requestCursor: string | null;
}

export interface SearchResultWindow<T extends SearchResultPageBoundary> {
  pages: T[];
  startPage: number;
}

export function searchResultPage<T extends SearchResultPageBoundary>(
  window: SearchResultWindow<T>,
  pageIndex: number
): T | null {
  return window.pages[pageIndex - window.startPage] ?? null;
}

export function searchResultPageRequest<
  T extends SearchResultPageBoundary,
>(input: {
  window: SearchResultWindow<T>;
  pageIndex: number;
  refresh: boolean;
}): { pageIndex: number; cursor: string | null } | null {
  const { window, pageIndex, refresh } = input;
  if (window.pages.length === 0) {
    return { cursor: null, pageIndex: 0 };
  }
  const page = searchResultPage(window, pageIndex);
  if (page) {
    return refresh ? { cursor: page.requestCursor, pageIndex } : null;
  }
  const [first] = window.pages;
  const last = window.pages.at(-1);
  if (pageIndex < window.startPage && first?.previousCursor) {
    return { cursor: first.previousCursor, pageIndex: window.startPage - 1 };
  }
  if (pageIndex >= window.startPage + window.pages.length && last?.nextCursor) {
    return {
      cursor: last.nextCursor,
      pageIndex: window.startPage + window.pages.length,
    };
  }
  return null;
}

export function retainSearchResultPage<
  T extends SearchResultPageBoundary,
>(input: {
  window: SearchResultWindow<T>;
  pageIndex: number;
  page: T;
}): SearchResultWindow<T> {
  const { window, pageIndex, page } = input;
  if (window.pages.length === 0) {
    return { pages: [page], startPage: pageIndex };
  }
  const endPage = window.startPage + window.pages.length;
  if (pageIndex < window.startPage - 1 || pageIndex > endPage) {
    return { pages: [page], startPage: pageIndex };
  }
  let startPage = Math.min(window.startPage, pageIndex);
  const pages = [...window.pages];
  if (pageIndex < window.startPage) {
    pages.unshift(page);
  } else if (pageIndex === endPage) {
    pages.push(page);
  } else {
    pages[pageIndex - window.startPage] = page;
  }
  while (pages.length > MAX_RETAINED_SEARCH_PAGES) {
    const distanceFromStart = pageIndex - startPage;
    const distanceFromEnd = startPage + pages.length - 1 - pageIndex;
    if (distanceFromStart >= distanceFromEnd) {
      pages.shift();
      startPage += 1;
    } else {
      pages.pop();
    }
  }
  return { pages, startPage };
}
