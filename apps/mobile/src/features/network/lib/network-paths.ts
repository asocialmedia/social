const HOSTS = new Set(["asocialmedia.cc", "www.asocialmedia.cc"]);

export function nativeNetworkPath(value: string): string | null {
  let path = value;
  if (!value.startsWith("/")) {
    try {
      const url = new URL(value);
      if (url.protocol === "asocialmedia:") {
        path = `/${url.host}${url.pathname}${url.search}`;
      } else if (url.protocol === "https:" && HOSTS.has(url.hostname)) {
        path = `${url.pathname}${url.search}`;
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  if (path.startsWith("//") || /[\\\r\n]/.test(path)) {
    return null;
  }
  const url = new URL(path, "https://asocialmedia.cc");
  if (url.pathname === "/network/bluesky/profile") {
    const actor = url.searchParams.get("actor");
    return actor ? `/external-profile?${new URLSearchParams({ actor })}` : null;
  }
  if (url.pathname === "/network/bluesky") {
    const uri = url.searchParams.get("uri");
    if (!uri?.startsWith("at://")) {
      return null;
    }
    const media = url.searchParams.get("media");
    return media === null
      ? `/external-post?${new URLSearchParams({ uri })}`
      : `/external-media?${new URLSearchParams({ index: media, uri })}`;
  }
  if (url.pathname === "/messages" && url.searchParams.has("c")) {
    const conversation = url.searchParams.get("c");
    return conversation && /^[a-zA-Z0-9_-]+$/.test(conversation)
      ? `/messages/${conversation}`
      : null;
  }
  const post =
    /^\/(?:a\/[^/]+\/)?posts\/(?<postId>[^/]+)(?:\/media\/(?<index>\d+))?/.exec(
      url.pathname
    );
  if (post) {
    const media = /\/media\/(?<index>\d+)\/?$/.exec(url.pathname)?.groups
      ?.index;
    return media
      ? `/posts/${post.groups?.postId}/media/${media}${url.search}`
      : `/posts/${post.groups?.postId}${url.search}`;
  }
  if (
    /^\/(?:users\/[^/]+(?:\/(?:followers|following))?|a\/[^/]+|messages(?:\/[^/]+(?:\/[^/]+)?)?|external-(?:post|profile|media|library|following)|settings|gusts|discover|bookmarks|history|notifications|communities|hashtag\/[^/]+|login)$/.test(
      url.pathname
    ) ||
    url.pathname === "/"
  ) {
    return `${url.pathname}${url.search}`;
  }
  // Web's short profile URLs (953ef2d3 profilePath): `/<username>` and its
  // followers/following lists open the native profile under /users/. A name
  // that collides with a web route is never a profile there either.
  const profile =
    /^\/(?<username>[A-Za-z0-9_]+)(?<list>\/(?:followers|following))?\/?$/.exec(
      url.pathname
    );
  const username = profile?.groups?.username;
  if (username && !WEB_APP_PATHS.has(username.toLowerCase())) {
    return `/users/${username}${profile.groups?.list ?? ""}`;
  }
  return null;
}

// Web's appPaths (apps/web/src/lib/users/profile-path.ts): top-level routes
// that are never a short profile URL.
const WEB_APP_PATHS = new Set([
  "a",
  "about",
  "api",
  "bookmarks",
  "camera",
  "client",
  "communities",
  "discover",
  "gusts",
  "hackernews",
  "hashtag",
  "login",
  "messages",
  "network",
  "notifications",
  "posts",
  "privacy",
  "settings",
  "signup",
  "sitemaps",
  "soon",
  "support",
  "toc",
  "users",
]);

export function externalShareUrl(
  uri: string,
  origin = "https://asocialmedia.cc"
) {
  return `${origin.replace(/\/+$/, "")}/network/bluesky?${new URLSearchParams({ uri })}`;
}
