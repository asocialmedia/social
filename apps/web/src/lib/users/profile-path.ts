const appPaths = new Set([
  ".well-known",
  "_next",
  "a",
  "about",
  "api",
  "bookmarks",
  "camera",
  "client",
  "communities",
  "discover",
  "feed.xml",
  "gusts",
  "hackernews",
  "hashtag",
  "llms.txt",
  "login",
  "messages",
  "network",
  "notifications",
  "posts",
  "privacy",
  "reset-password",
  "settings",
  "signup",
  "sitemap.xml",
  "sitemaps",
  "soon",
  "support",
  "toc",
  "two-factor",
  "users",
  "verify-email",
]);

export function profilePath(username: string) {
  const name = encodeURIComponent(username);
  return appPaths.has(username.toLowerCase()) ? `/users/${name}` : `/${name}`;
}

export function legacyProfileDestination(pathname: string) {
  const match =
    /^\/users\/(?<username>[^/]+)(?<suffix>\/(?:followers|following|opengraph-image))?\/?$/.exec(
      pathname
    );
  if (!match?.groups?.username) {
    return null;
  }
  try {
    const username = decodeURIComponent(match.groups.username);
    const path = profilePath(username);
    return path.startsWith("/users/")
      ? null
      : `${path}${match.groups.suffix ?? ""}`;
  } catch {
    return null;
  }
}
