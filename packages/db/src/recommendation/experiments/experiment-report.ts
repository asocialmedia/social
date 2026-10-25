export interface ExperimentEvent {
  durationMs?: number | null;
  eventType: string;
  postId: string;
  userId: string;
  rankingContext: unknown;
}

function attributedEvent(event: ExperimentEvent) {
  const context = event.rankingContext;
  if (
    !context ||
    typeof context !== "object" ||
    !("requestId" in context) ||
    typeof context.requestId !== "string" ||
    !("variant" in context) ||
    typeof context.variant !== "string" ||
    !("rankerVersion" in context) ||
    typeof context.rankerVersion !== "string"
  ) {
    return null;
  }
  const experiment =
    "experiment" in context && typeof context.experiment === "string"
      ? context.experiment
      : "legacy";
  const contentKind =
    "contentKind" in context && typeof context.contentKind === "string"
      ? context.contentKind
      : "unknown";
  const key = `${experiment}:${context.rankerVersion}:${context.variant}:${contentKind}`;
  return {
    contentKind,
    experiment,
    exposure: `${key}:${event.userId}:${context.requestId}:${event.postId}`,
    key,
    rankerVersion: context.rankerVersion,
    variant: context.variant,
  };
}

export function recommendationExperimentReport(
  events: readonly ExperimentEvent[]
) {
  const attributed = events.map((event) => ({
    context: attributedEvent(event),
    event,
  }));
  const impressions = new Set(
    attributed
      .filter(({ event }) => event.eventType === "IMPRESSION")
      .flatMap(({ context }) => (context ? [context.exposure] : []))
  );
  const groups = new Map<
    string,
    {
      contentKind: string;
      experiment: string;
      rankerVersion: string;
      variant: string;
      users: Set<string>;
      counts: Map<string, Set<string>>;
      startup: number[];
      dwellMs: number;
    }
  >();
  let unattributed = 0;
  let unpaired = 0;
  for (const { event, context } of attributed) {
    if (!context) {
      unattributed += 1;
      continue;
    }
    const group = groups.get(context.key) ?? {
      contentKind: context.contentKind,
      counts: new Map<string, Set<string>>(),
      dwellMs: 0,
      experiment: context.experiment,
      rankerVersion: context.rankerVersion,
      startup: [],
      users: new Set<string>(),
      variant: context.variant,
    };
    groups.set(context.key, group);
    // Pair numerators with impressions in this report window, including sampled reports.
    if (!impressions.has(context.exposure)) {
      unpaired += 1;
      continue;
    }
    group.users.add(event.userId);
    const seen = group.counts.get(event.eventType) ?? new Set<string>();
    const first = !seen.has(context.exposure);
    seen.add(context.exposure);
    group.counts.set(event.eventType, seen);
    if (
      first &&
      event.eventType === "PLAYBACK_STARTUP" &&
      typeof event.durationMs === "number"
    ) {
      group.startup.push(event.durationMs);
    }
    if (event.eventType === "DWELL") {
      group.dwellMs += Math.max(0, event.durationMs ?? 0);
    }
  }
  return {
    groups: [...groups.values()].map((group) => {
      const count = (type: string) => group.counts.get(type)?.size ?? 0;
      const denominator = count("IMPRESSION");
      const rate = (type: string) =>
        denominator ? count(type) / denominator : null;
      const startup = group.startup.toSorted((a, b) => a - b);
      return {
        completions: count("VIEW_COMPLETE"),
        completionsPerImpression: rate("VIEW_COMPLETE"),
        contentKind: group.contentKind,
        dwellMs: group.dwellMs,
        experiment: group.experiment,
        impressions: denominator,
        notInterestedPerImpression: rate("NOT_INTERESTED"),
        playbackErrorsPerImpression: rate("PLAYBACK_ERROR"),
        rankerVersion: group.rankerVersion,
        saves: count("BOOKMARK"),
        savesPerImpression: rate("BOOKMARK"),
        startupP95Ms:
          startup[Math.max(0, Math.ceil(startup.length * 0.95) - 1)] ?? null,
        users: group.users.size,
        variant: group.variant,
      };
    }),
    unattributedEvents: unattributed,
    unpairedEvents: unpaired,
  };
}
