// Which avatar bytes Satori can actually decode, and the fallback when it cannot.
//
// The OG cards are rendered by Satori (via next/og), which supports only
// PNG, JPEG, GIF and SVG. It does NOT decode WebP or AVIF. Avatars uploaded
// through the media pipeline publish as WebP, so a card that points an <img>
// straight at the avatar proxy loses the image and logs
// "Can't load image ...: Unsupported image type: image/webp".
//
// That failure is also sticky: Satori memoises image loads by source URL for
// the life of the process, so one bad fetch poisons every later render of the
// same card until the server restarts.
//
// Deciding from the stored key means the card either asks for a format Satori
// can render or draws the initial-letter placeholder, and never issues an
// outbound fetch it cannot satisfy.

const SATORI_SAFE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg"]);

export function avatarExtension(key: string | null | undefined): string {
  if (!key) {
    return "";
  }
  const withoutQuery = key.split(/[?#]/, 1)[0] ?? "";
  const lastSegment = withoutQuery.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  return dot === -1 ? "" : lastSegment.slice(dot + 1).toLowerCase();
}

// True when the stored object is a format Satori can decode, so an <img> can
// safely point at it. An unknown extension is treated as unrenderable: serving
// the placeholder is better than a card that silently drops the avatar.
export function canSatoriRenderAvatar(key: string | null | undefined): boolean {
  return SATORI_SAFE_EXTENSIONS.has(avatarExtension(key));
}

// The first letter of the name to draw inside the placeholder disc, matching
// the branch the card already uses when a user has no avatar at all.
export function avatarInitial(
  displayName: string | null | undefined,
  username: string | null | undefined
): string {
  return (displayName || username || "?")[0]?.toUpperCase() ?? "?";
}
