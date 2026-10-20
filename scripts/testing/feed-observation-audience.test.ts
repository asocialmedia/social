import { expect, test } from "bun:test";

import { feedObservationAudienceMatches } from "./feed-observation-audience";

test("load checks require the requested viewer's receipt rather than accepting guest or cross-viewer success", () => {
  const token = `header.${Buffer.from(JSON.stringify({ aud: "viewer" })).toString("base64url")}.signature`;
  expect(
    feedObservationAudienceMatches(
      { networkRecommendationToken: token },
      "viewer"
    )
  ).toBe(true);
  expect(
    feedObservationAudienceMatches(
      { networkRecommendationToken: token },
      "other"
    )
  ).toBe(false);
  expect(feedObservationAudienceMatches({}, "viewer")).toBe(false);
  expect(
    feedObservationAudienceMatches(
      { networkRecommendationToken: "broken" },
      "viewer"
    )
  ).toBe(false);
});
