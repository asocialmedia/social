import type { UserListMutual } from "./user-list";

export interface ProfileMutuals {
  counts: { followers: number; following: number };
  followers: UserListMutual[];
  following: UserListMutual[];
}

function parseUsers(value: unknown): UserListMutual[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const user = entry as Record<string, unknown>;
    if (
      typeof user.id !== "string" ||
      !user.id ||
      seen.has(user.id) ||
      typeof user.username !== "string" ||
      !user.username
    ) {
      return [];
    }
    seen.add(user.id);
    return [
      {
        avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : null,
        displayName:
          typeof user.displayName === "string" ? user.displayName : null,
        id: user.id,
        username: user.username,
      },
    ];
  });
}

function mutualCount(value: unknown, users: readonly UserListMutual[]) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= users.length
    ? value
    : users.length;
}

export function parseProfileMutuals(value?: unknown): ProfileMutuals {
  const mutuals =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const followers = parseUsers(mutuals.followers);
  const following = parseUsers(mutuals.following);
  const counts =
    typeof mutuals.counts === "object" && mutuals.counts !== null
      ? (mutuals.counts as Record<string, unknown>)
      : {};
  return {
    counts: {
      followers: mutualCount(counts.followers, followers),
      following: mutualCount(counts.following, following),
    },
    followers: followers.slice(0, 3),
    following: following.slice(0, 3),
  };
}

export function profileMutualLabel(
  kind: "followers" | "following",
  users: readonly UserListMutual[],
  total = users.length
) {
  const names = users
    .map((user) => user.displayName || `@${user.username}`)
    .join(", ");
  const label =
    kind === "followers"
      ? `People you follow who follow this profile: ${names}`
      : `Accounts you both follow: ${names}`;
  const remaining = Math.max(0, total - users.length);
  return remaining ? `${label}, and ${remaining} more` : label;
}
