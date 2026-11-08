// Per-verb generation counters for optimistic mutations (audit S0-4).
// Rapid taps resolve out of order, so only the latest tap's response or
// rollback may settle state. Votes and bookmarks hold separate generations:
// one shared counter let a bookmark error after an intervening vote read a
// newer generation and return silently without rolling back.
export type OptimisticVerb = "bookmark" | "vote";

export class MutationGenerations {
  private counters: Record<OptimisticVerb, number> = {
    bookmark: 0,
    vote: 0,
  };

  // Starts a new attempt for this verb, invalidating every earlier one.
  begin(verb: OptimisticVerb): number {
    this.counters[verb] += 1;
    return this.counters[verb];
  }

  // True when no newer attempt for the same verb started since. Attempts for
  // the other verb never invalidate this one.
  isCurrent(verb: OptimisticVerb, generation: number): boolean {
    return this.counters[verb] === generation;
  }
}
