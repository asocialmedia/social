// Native port of web's use-community-section-links +
// community-section-store
// (apps/web/src/hooks/use-community-section-links.ts,
// apps/web/src/store/community-section-store.ts) without zustand: the
// last-visited section hrefs per (viewer, community) scope, bounded to the 32
// most recent scopes like web. The Posts tab deep-links back to the
// last-visited chat channel, and Chat-side Posts buttons restore the stored
// posts href (with its feed filters) instead of the bare community root.
const MAX_SECTION_SCOPES = 32;

interface SectionLocation {
  chatHref?: `/a/${string}`;
  postsHref?: `/a/${string}`;
}

const locations = new Map<string, SectionLocation>();

export function communitySectionScope(
  viewerId: string | undefined,
  slug: string
): string {
  return JSON.stringify([viewerId ?? "guest", slug]);
}

function rememberSection(scope: string, location: SectionLocation): void {
  const previous = locations.get(scope);
  const next = { ...previous, ...location };
  if (
    previous?.chatHref === next.chatHref &&
    previous?.postsHref === next.postsHref
  ) {
    return;
  }
  locations.delete(scope);
  locations.set(scope, next);
  if (locations.size > MAX_SECTION_SCOPES) {
    const oldest = locations.keys().next();
    if (!oldest.done) {
      locations.delete(oldest.value);
    }
  }
}

export function rememberCommunityChatHref(
  viewerId: string | undefined,
  slug: string,
  href: `/a/${string}`
): void {
  rememberSection(communitySectionScope(viewerId, slug), { chatHref: href });
}

export function rememberCommunityPostsHref(
  viewerId: string | undefined,
  slug: string,
  href: `/a/${string}`
): void {
  rememberSection(communitySectionScope(viewerId, slug), { postsHref: href });
}

export function communityPostsHref(
  viewerId: string | undefined,
  slug: string
): `/a/${string}` {
  return (
    locations.get(communitySectionScope(viewerId, slug))?.postsHref ??
    `/a/${slug}`
  );
}

export function communityChatHref(
  viewerId: string | undefined,
  slug: string,
  channelId?: string | null
): `/a/${string}` {
  if (channelId) {
    return `/a/${slug}/chat/${channelId}`;
  }
  return (
    locations.get(communitySectionScope(viewerId, slug))?.chatHref ??
    `/a/${slug}/chat`
  );
}
