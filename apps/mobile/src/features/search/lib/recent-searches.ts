// Web's rememberSearch / rememberResult (components/search/spotlight-search.ts)
// over the on-device recent list. An opened result replaces the same result
// and any typed query with the same text (case-insensitive); a typed query
// replaces only an earlier typed query with the same text and network, and
// never drops an opened result. The list keeps the newest ten.
interface RecentEntry {
  href?: string;
  id?: string;
  query: string;
  source: string;
}

export const RECENT_SEARCH_LIMIT = 10;

function sameTarget(left: RecentEntry, right: RecentEntry): boolean {
  if (left.id && right.id) {
    return left.id === right.id;
  }
  return left.href === right.href;
}

export function rememberRecent<Entry extends RecentEntry>(
  items: readonly Entry[],
  entry: Entry
): Entry[] {
  const query = entry.query.toLowerCase();
  const kept = items.filter((previous) => {
    if (entry.href) {
      return previous.href
        ? !sameTarget(previous, entry)
        : previous.query.toLowerCase() !== query;
    }
    return (
      Boolean(previous.href) ||
      previous.query.toLowerCase() !== query ||
      previous.source !== entry.source
    );
  });
  return [entry, ...kept].slice(0, RECENT_SEARCH_LIMIT);
}

// Web's readTarget: a sensitive post is remembered, but never by its text.
export function recentLabel(label: string, explicit: boolean | undefined) {
  return explicit ? "Sensitive post" : label.slice(0, 280);
}
