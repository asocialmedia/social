// Declared interests scope eligibility; actual activity is needed before quietly engaged posts join discovery.
export function isDiscoveryColdStart(
  interests: readonly string[],
  profile: {
    authorWeights?: Record<string, number>;
    tagWeights?: Record<string, number>;
    topicAffinities?: Record<string, number>;
    sessionTagWeights?: Record<string, number>;
  } = {},
  signalCount?: number
): boolean {
  if (signalCount !== undefined) {
    return signalCount < 3;
  }
  return (
    interests.length === 0 &&
    !Object.values(profile.authorWeights ?? {}).some(
      (weight) => Number.isFinite(weight) && weight >= 1
    ) &&
    ![
      profile.tagWeights,
      profile.topicAffinities,
      profile.sessionTagWeights,
    ].some((weights) =>
      Object.values(weights ?? {}).some(
        (weight) => Number.isFinite(weight) && weight >= 0.15
      )
    )
  );
}
