export interface GustHeaderScroll {
  anchor: number;
  visible: boolean;
}

// Accumulate real movement so fractional scroll noise cannot flicker the header.
export function advanceGustHeader(
  offset: number,
  previous: GustHeaderScroll
): GustHeaderScroll {
  "worklet";
  const position = Math.max(0, offset);
  if (position <= 1) {
    return { anchor: position, visible: true };
  }
  if (Math.abs(position - previous.anchor) < 10) {
    return previous;
  }
  return { anchor: position, visible: position < previous.anchor };
}

export interface GustFollowingAvatar {
  avatarUrl: string | null;
  id: string;
  username?: string | null;
}

// The current clip's source leads, followed by upcoming clips, then the earlier ones.
export function followingGustAvatars(
  posts: readonly { followingSources?: readonly GustFollowingAvatar[] }[],
  activeIndex = 0,
  limit = 3
): GustFollowingAvatar[] {
  const ordered = [...posts.slice(activeIndex), ...posts.slice(0, activeIndex)];
  const seen = new Set<string>();
  const avatars: GustFollowingAvatar[] = [];
  for (const post of ordered) {
    for (const source of post.followingSources ?? []) {
      if (seen.has(source.id)) {
        continue;
      }
      seen.add(source.id);
      avatars.push(source);
      if (avatars.length >= limit) {
        return avatars;
      }
    }
  }
  return avatars;
}
