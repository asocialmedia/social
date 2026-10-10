import type { GustFollowingAvatar } from "./gust-header";

export type DiscoveryFleetFeed = "personalized" | "trending";

export function discoveryFleetFeed(
  active: string,
  remembered: DiscoveryFleetFeed
): DiscoveryFleetFeed {
  return active === "personalized" || active === "trending"
    ? active
    : remembered;
}

// Followed authors lead in feed order; remaining followed people fill an empty feed.
export function followingFleetAvatars(
  posts: readonly { userId: string }[],
  people: readonly GustFollowingAvatar[],
  limit = 3
): GustFollowingAvatar[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const ordered = [...posts.map((post) => byId.get(post.userId)), ...people];
  const seen = new Set<string>();
  const result: GustFollowingAvatar[] = [];
  for (const person of ordered) {
    if (!person || seen.has(person.id)) {
      continue;
    }
    seen.add(person.id);
    result.push(person);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}
