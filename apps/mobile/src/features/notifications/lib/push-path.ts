// Maps a push payload's web path onto a native route. Post paths carry the
// short id (or full id) after /posts/, either at the root (/posts/<id>) or
// nested in a community (/a/<slug>/posts/<id>); the detail screen accepts
// either id form and has no community-aware route yet, so the community
// segment is dropped and the post itself opens. Gust links
// (/gusts?id=<full id>, web's getPostPath for gusts) open the native reel on
// that gust. Pure, so it unit-tests without expo-notifications.
const GUST_ID_PATTERN = /^\/gusts\/?\?(?:[^#]*&)?id=(?<id>[^&#]+)/;

export function pathToNativeRoute(path: string): string {
  const gustId = GUST_ID_PATTERN.exec(path)?.groups?.id;
  if (gustId) {
    return `/gusts?id=${gustId}`;
  }
  const postMatch =
    /^\/posts\/(?<id>[^/?#]+)/.exec(path) ??
    /^\/a\/[^/]+\/posts\/(?<id>[^/?#]+)/.exec(path);
  const id = postMatch?.groups?.id;
  return id ? `/posts/${id}` : "/notifications";
}
