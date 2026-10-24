// The local workload checks response identity as well as status, so an auth outage cannot count a guest feed as a successful personalized read.
export function feedObservationAudienceMatches(
  post: unknown,
  viewerId: string
) {
  if (
    !post ||
    typeof post !== "object" ||
    !("networkRecommendationToken" in post) ||
    typeof post.networkRecommendationToken !== "string"
  ) {
    return false;
  }
  try {
    const payload = post.networkRecommendationToken.split(".")[1];
    if (!payload) return false;
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    return Boolean(
      decoded &&
      typeof decoded === "object" &&
      "aud" in decoded &&
      decoded.aud === viewerId
    );
  } catch {
    return false;
  }
}
