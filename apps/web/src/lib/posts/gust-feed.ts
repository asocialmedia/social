import type { PresentedPost } from "./presentation";

// Fill the reel from both networks without moving clips the viewer has already loaded.
export function mergeGustPosts(
  previous: readonly PresentedPost[],
  native: readonly PresentedPost[],
  external: readonly PresentedPost[]
): PresentedPost[] {
  const candidates: PresentedPost[] = [];
  const count = Math.max(native.length, external.length);
  for (let index = 0; index < count; index += 1) {
    if (native[index]) {
      candidates.push(native[index]);
    }
    if (external[index]) {
      candidates.push(external[index]);
    }
  }
  const current = new Map(candidates.map((post) => [post.id, post]));
  const retained = previous.flatMap((post) => {
    const updated = current.get(post.id);
    current.delete(post.id);
    return updated ? [updated] : [];
  });
  return [...retained, ...current.values()];
}
