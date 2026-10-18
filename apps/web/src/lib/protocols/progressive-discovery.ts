import { readDiscoveryWindow } from "@asm/protocols/discovery";
import type { DiscoveryPage } from "@asm/protocols/discovery";

export interface DiscoveryPosition {
  cursor: string | null;
  level: number;
  topicPage: number;
  pages: number;
}

export type ProgressiveDiscoveryPage = DiscoveryPage & {
  nextPosition: DiscoveryPosition | null;
};

export const initialDiscoveryPosition: DiscoveryPosition = {
  cursor: null,
  level: 0,
  pages: 0,
  topicPage: 0,
};

export function nextDiscoveryPosition(
  position: DiscoveryPosition,
  page: DiscoveryPage
): DiscoveryPosition | null {
  if (page.cursor && page.items.length && position.pages < 3) {
    return { ...position, cursor: page.cursor, pages: position.pages + 1 };
  }
  if (position.level === 0) {
    return { cursor: null, level: 1, pages: 0, topicPage: 0 };
  }
  if (position.level === 1) {
    return page.moreRelatedTopics
      ? { cursor: null, level: 1, pages: 0, topicPage: position.topicPage + 1 }
      : { cursor: null, level: 2, pages: 0, topicPage: 0 };
  }
  return page.cursor
    ? { ...position, cursor: page.cursor, pages: position.pages + 1 }
    : null;
}

// Each load can move through the focused, neighboring and broad pools without recycling a head.
export async function readProgressiveDiscovery(
  options: Parameters<typeof readDiscoveryWindow>[0],
  position: DiscoveryPosition,
  known: ReadonlySet<string>,
  read = readDiscoveryWindow
): Promise<ProgressiveDiscoveryPage> {
  let current = position;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each bounded read depends on the previous pool's continuation.
    const page = await read(
      {
        ...options,
        cursor: current.cursor,
        discoveryLevel: current.level,
        signal,
        topicPage: current.topicPage,
      },
      known
    );
    const nextPosition = nextDiscoveryPosition(current, page);
    if (page.items.length || !nextPosition || attempt === 2) {
      return { ...page, nextPosition };
    }
    current = nextPosition;
  }
  throw new Error("Discovery did not advance");
}
