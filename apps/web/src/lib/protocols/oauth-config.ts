export const BLUESKY_OAUTH_SCOPE =
  "atproto repo:app.bsky.feed.post?action=create repo:app.bsky.feed.like?action=create&action=delete repo:app.bsky.feed.repost?action=create&action=delete rpc:app.bsky.bookmark.createBookmark?aud=did:web:api.bsky.app%23bsky_appview rpc:app.bsky.bookmark.deleteBookmark?aud=did:web:api.bsky.app%23bsky_appview rpc:app.bsky.feed.getPosts?aud=did:web:api.bsky.app%23bsky_appview";

export function hasBlueskyRepoPermission(
  scope: string | undefined,
  collection: string,
  action: "create" | "delete"
) {
  return (scope ?? "").split(/\s+/u).some((permission) => {
    const [resource, query] = permission.split("?", 2);
    if (resource !== `repo:${collection}` && resource !== "repo:*") {
      return false;
    }
    const actions = new URLSearchParams(query).getAll("action");
    return !actions.length || actions.includes(action);
  });
}
export const BLUESKY_OAUTH_COOKIE = "asm-bluesky-oauth";
export const BLUESKY_OAUTH_CALLBACK = "/api/protocols/bluesky/oauth/callback";

export function blueskyOAuthMetadata(origin: string) {
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(
      "Bluesky OAuth requires HTTPS or a loopback development origin"
    );
  }
  // AT Protocol only accepts an IP loopback redirect for the development client ID.
  if (loopback) {
    url.hostname = "127.0.0.1";
  }
  const redirect = new URL(BLUESKY_OAUTH_CALLBACK, url.origin).href;
  const developmentId = new URL("http://localhost");
  developmentId.searchParams.set("redirect_uri", redirect);
  developmentId.searchParams.set("scope", BLUESKY_OAUTH_SCOPE);
  return {
    application_type: "web" as const,
    client_id: loopback
      ? developmentId.href
      : new URL("/api/protocols/bluesky/client-metadata", url.origin).href,
    client_name: "asocialmedia",
    client_uri: url.origin,
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"] as [
      "authorization_code",
      "refresh_token",
    ],
    redirect_uris: [redirect] as [string],
    response_types: ["code"] as ["code"],
    scope: BLUESKY_OAUTH_SCOPE,
    token_endpoint_auth_method: "none" as const,
  };
}
