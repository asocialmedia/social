// Diversity-enforced ranking for the For-You feed. Candidates arrive with
// scores from scoreCandidate; this orders them deterministically (score desc,
// id asc tiebreak) and then enforces author diversity while filling the page:
// at most a couple of consecutive slots per author, and a hard cap on the
// share of the page any single author may occupy.

export interface ScoredCandidate<T> {
  post: T;
  score: number;
}

export interface FeedDiversityConfig {
  // No more than this many posts by the same author back to back.
  maxConsecutivePerAuthor?: number;
  // No single author may fill more than this fraction of the page.
  maxSingleAuthorShare?: number;
  pageSize: number;
}

const DEFAULT_MAX_CONSECUTIVE_PER_AUTHOR = 2;
const DEFAULT_MAX_SINGLE_AUTHOR_SHARE = 0.3;

// Deterministic ordering: score descending, then id ascending so equal-score
// candidates always rank identically across requests and processes.
function compareCandidates<T extends { id: string }>(
  a: ScoredCandidate<T>,
  b: ScoredCandidate<T>
): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.post.id < b.post.id ? -1 : 1;
}

// Greedy diversity fill: walk candidates in score order, skipping ones that
// would violate either constraint, and keep them for later passes where the
// sliding constraints may have relaxed. Guarantees min(pageSize,
// candidates.length) results: if strict diversity cannot fill the page, a
// final pass appends the leftovers in score order.
export function rankFeed<T extends { authorId: string; id: string }>(
  candidates: ScoredCandidate<T>[],
  config: FeedDiversityConfig
): T[] {
  const { maxSingleAuthorShare = DEFAULT_MAX_SINGLE_AUTHOR_SHARE, pageSize } =
    config;
  const maxConsecutivePerAuthor =
    config.maxConsecutivePerAuthor ?? DEFAULT_MAX_CONSECUTIVE_PER_AUTHOR;

  const sorted = [...candidates].toSorted(compareCandidates);
  const authorCap = Math.max(1, Math.floor(pageSize * maxSingleAuthorShare));

  const selected: T[] = [];
  const perAuthorCount = new Map<string, number>();
  let consecutiveRun = 0;
  let lastAuthor: string | null = null;

  const canPlace = (authorId: string): boolean => {
    const placed = perAuthorCount.get(authorId) ?? 0;
    if (placed >= authorCap) {
      return false;
    }
    if (authorId === lastAuthor && consecutiveRun >= maxConsecutivePerAuthor) {
      return false;
    }
    return true;
  };

  const place = (post: T): void => {
    selected.push(post);
    perAuthorCount.set(
      post.authorId,
      (perAuthorCount.get(post.authorId) ?? 0) + 1
    );
    consecutiveRun = post.authorId === lastAuthor ? consecutiveRun + 1 : 1;
    lastAuthor = post.authorId;
  };

  let deferred = sorted;
  // Main passes: keep re-scanning deferred candidates until no progress, so
  // blocked candidates get another chance once other authors filled slots.
  let progress = true;
  while (selected.length < pageSize && progress) {
    progress = false;
    const stillDeferred: ScoredCandidate<T>[] = [];
    for (const candidate of deferred) {
      if (selected.length >= pageSize) {
        stillDeferred.push(candidate);
        continue;
      }
      if (canPlace(candidate.post.authorId)) {
        place(candidate.post);
        progress = true;
      } else {
        stillDeferred.push(candidate);
      }
    }
    deferred = stillDeferred;
  }

  // Completeness fallback: a page must never come back short just because
  // the pool is dominated by one author; append what remains in score order.
  for (const candidate of deferred) {
    if (selected.length >= pageSize) {
      break;
    }
    selected.push(candidate.post);
  }

  return selected;
}
