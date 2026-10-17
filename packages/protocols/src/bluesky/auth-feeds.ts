// Bluesky feeds that require user session authentication/JWT or personal viewer context.
const authFeedRkeys = new Set([
  "followpics",
  "for-you",
  "mentions",
  "mutuals",
  "only-posts",
  "with-friends",
]);

const authFeedDescriptionPatterns = [
  /requires? (?:user )?auth/i,
  /jwt token/i,
  /logged in(?:to)?/i,
  /based on (?:your )?likes/i,
  /(?:accounts|people|users|profiles) you follow/i,
  /mutual follows/i,
  /following you(?: back)?/i,
  /quote post you/i,
  /personal(?:ized)? (?:algorithmic )?feed/i,
];

const authNoticePattern =
  /(?:feed requires? authentication|no jwt token|logged into your bluesky account to access|you have to be logged in for this feed)/i;

export function isAuthFeedUri(uri: string): boolean {
  const rkey = uri.split("/").pop();
  if (rkey && authFeedRkeys.has(rkey)) {
    return true;
  }
  if (
    uri ===
    "at://did:plc:tenurhgjptubkk5zf5qhi3og/app.bsky.feed.generator/discover"
  ) {
    return true;
  }
  return false;
}

export function isAuthFeed(feed: {
  uri: string;
  displayName?: string;
  description?: string;
}): boolean {
  if (isAuthFeedUri(feed.uri)) {
    return true;
  }
  if (feed.description) {
    for (const pattern of authFeedDescriptionPatterns) {
      if (pattern.test(feed.description)) {
        return true;
      }
    }
  }
  return false;
}

export function isAuthenticationNotice(text: string): boolean {
  return authNoticePattern.test(text);
}
