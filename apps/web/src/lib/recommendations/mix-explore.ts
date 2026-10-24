export type ExploreEntry<Native, External> =
  | { source: "asm"; post: Native }
  | { source: "bluesky"; post: External };

// Preserve each provider's ranking and continue with either provider during an outage.
export function mixExplorePosts<
  Native extends { id: string },
  External extends { id: string },
>(native: Native[], external: External[]): ExploreEntry<Native, External>[] {
  const result: ExploreEntry<Native, External>[] = [];
  const seen = new Set<string>();
  for (
    let index = 0;
    index < Math.max(native.length, external.length);
    index += 1
  ) {
    const local = native[index];
    const remote = external[index];
    if (local && !seen.has(`asm:${local.id}`)) {
      result.push({ post: local, source: "asm" });
      seen.add(`asm:${local.id}`);
    }
    if (remote && !seen.has(`bluesky:${remote.id}`)) {
      result.push({ post: remote, source: "bluesky" });
      seen.add(`bluesky:${remote.id}`);
    }
  }
  return result;
}

// Reserve every fifth slot for broader discovery while preserving ranking inside both pools.
export function diversifyExploreCandidates<T>(
  ranked: T[],
  related: (item: T) => boolean
): T[] {
  const adjacent = ranked.filter(related);
  const broad = ranked.filter((item) => !related(item));
  if (!adjacent.length || !broad.length) {
    return ranked;
  }
  const result: T[] = [];
  let adjacentIndex = 0;
  let broadIndex = 0;
  while (adjacentIndex < adjacent.length || broadIndex < broad.length) {
    if (
      (result.length % 5 === 4 || adjacentIndex >= adjacent.length) &&
      broadIndex < broad.length
    ) {
      result.push(broad[broadIndex]);
      broadIndex += 1;
    } else if (adjacentIndex < adjacent.length) {
      result.push(adjacent[adjacentIndex]);
      adjacentIndex += 1;
    } else {
      result.push(broad[broadIndex]);
      broadIndex += 1;
    }
  }
  return result;
}
