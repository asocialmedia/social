// Lazy mention-avatar resolution, ported from web's mention-pill.tsx: a
// rehydrated mention (stored bio/draft) carries only the username, so the
// pill resolves the avatar by username on first render. Web caches the row
// forever (staleTime: Infinity) with no retry on 401/404; the module cache
// below is the same contract. Failures that are not 401/404 are not cached,
// so a flaky network retries on the next mount.
export async function fetchMentionAvatar(
  apiBase: string,
  username: string
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBase}/api/users/username/${encodeURIComponent(username)}`
    );
  } catch {
    throw new Error("mention avatar unreachable");
  }
  if (response.status === 401 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`mention avatar HTTP ${response.status}`);
  }
  const data = (await response.json()) as { avatarUrl?: string | null };
  return data.avatarUrl ?? null;
}

const avatarCache = new Map<string, string | null>();

// Resolves each username once per session through `resolve`, returning only
// the usernames that produced an avatar. Known-missing (401/404 -> null)
// entries never refetch; rejected lookups stay uncached and retry later.
export async function resolveMentionAvatars(
  usernames: readonly string[],
  resolve: (username: string) => Promise<string | null>
): Promise<Record<string, string>> {
  const missing = [...new Set(usernames)].filter(
    (username) => !avatarCache.has(username)
  );
  await Promise.all(
    missing.map(async (username) => {
      try {
        avatarCache.set(username, await resolve(username));
      } catch {
        // Leave uncached: the next mount retries.
      }
    })
  );
  const found: Record<string, string> = {};
  for (const username of new Set(usernames)) {
    const cached = avatarCache.get(username);
    if (cached) {
      found[username] = cached;
    }
  }
  return found;
}

export function clearMentionAvatarCache(): void {
  avatarCache.clear();
}
