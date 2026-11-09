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
  const chat = communityChatPath(url);
  if (chat) {
    return chat;
  }
  // Web's public video share URL (lib/seo/video.ts videoWatchUrl). The media
  // screen resolves ?mediaId= to the right slide, so the index is only a seed.
  const watch =
    /^\/watch\/(?<postId>[A-Za-z0-9_-]+)\/(?<mediaId>[A-Za-z0-9_-]+)\/?$/.exec(
      url.pathname
    )?.groups;
  if (watch?.postId && watch.mediaId) {
    return `/posts/${watch.postId}/media/0?${new URLSearchParams({ mediaId: watch.mediaId })}`;
  }
  const legal = LEGAL_PATHS.get(url.pathname.replace(/\/+$/, ""));
  if (legal) {
    return legal;
  }
  const post =
    /^\/(?:a\/(?<slug>[A-Za-z0-9_-]+)\/)?posts\/(?<postId>[^/]+)(?:\/media\/(?<index>\d+))?/.exec(
      url.pathname
    );
  if (post) {
    const media = /\/media\/(?<index>\d+)\/?$/.exec(url.pathname)?.groups
      ?.index;
    // A community post keeps its community chrome, as web's /a/<slug>/posts
    // route does; the native screen redirects when the namespace is wrong.
    const base = post.groups?.slug
      ? `/a/${post.groups.slug}/posts/${post.groups?.postId}`
      : `/posts/${post.groups?.postId}`;
    return media
      ? `${base}/media/${media}${url.search}`
      : `${base}${url.search}`;
  }
  if (
    /^\/(?:users\/[^/]+(?:\/(?:followers|following))?|a\/[^/]+|messages(?:\/[^/]+(?:\/[^/]+)?)?|external-(?:post|profile|media|library|following)|camera|settings|gusts|hackernews|discover|bookmarks|history|notifications|communities|support|login-error|hashtag\/[^/]+|login)$/.test(
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

// Web's legal pages render in-app through the legal/[document] WebView screen.
const LEGAL_PATHS = new Map([
  ["/privacy", "/legal/privacy"],
  ["/toc", "/legal/terms"],
]);

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/u;

// Community chat links: /a/<slug>/chat[/<channel>[/threads/<thread>]], with an
// optional ?message= jump target. Shared by app links and push taps.
function communityChatPath(url: URL): string | null {
  const groups =
    /^\/a\/(?<slug>[a-zA-Z0-9_-]+)\/chat(?:\/(?<channel>[a-zA-Z0-9_-]+)(?:\/threads\/(?<thread>[a-zA-Z0-9_-]+))?)?\/?$/u.exec(
      url.pathname
    )?.groups;
  if (!groups?.slug) {
    return null;
  }
  const channel = groups.channel ? `/${groups.channel}` : "";
  const thread = groups.thread ? `/threads/${groups.thread}` : "";
  const message = url.searchParams.get("message");
  const query =
    message && SAFE_SEGMENT.test(message) ? `?message=${message}` : "";
  return `/a/${groups.slug}/chat${channel}${thread}${query}`;
}

// Where an incoming system link lands when nothing maps it. Home is the only
// screen every viewer, signed in or not, can always render.
export const UNMAPPED_LINK_FALLBACK = "/";

// Web's appPaths (apps/web/src/lib/users/profile-path.ts): top-level routes
// that are never a short profile URL.
const WEB_APP_PATHS = new Set([
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
  "login-error",
  "messages",
  "network",
  "notifications",
  "posts",
  "privacy",
  "reset-password",
  "settings",
  "signup",
  "sitemaps",
  "soon",
  "support",
  "toc",
  "two-factor",
  "users",
  "verify-email",
  "watch",
]);

export function externalShareUrl(
  uri: string,
  origin = "https://asocialmedia.cc"
) {
  return `${origin.replace(/\/+$/, "")}/network/bluesky?${new URLSearchParams({ uri })}`;
}
