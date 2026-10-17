export function blueskyProfilePath(actor: string) {
  return `/network/bluesky/profile?actor=${encodeURIComponent(actor)}`;
}
