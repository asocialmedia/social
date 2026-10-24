import { getNetworkPersona } from "@asm/db";
import type { UserProfile } from "@asm/db";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

export function networkFeedContext(
  userId: string | undefined,
  requestedProfileId?: string
) {
  const guestProfile: UserProfile = { authorWeights: {}, tagWeights: {} };
  if (!userId) {
    return Promise.resolve({
      preferences: defaultNetworkPreferences(),
      profile: guestProfile,
      revision: 0,
      selected: { id: "default", interests: [], name: "Everyday" },
      topicScope: undefined,
    });
  }
  return getNetworkPersona(userId, requestedProfileId);
}

export type NetworkFeedContext = Awaited<ReturnType<typeof networkFeedContext>>;

export function networkRegionalLocale(
  context: NetworkFeedContext,
  fallback: string
) {
  const { language, region } = context.preferences;
  const base =
    language === "auto" || language === "all"
      ? (fallback.split("-")[0] ?? "en")
      : language;
  if (region === "all") {
    return base;
  }
  if (region === "auto") {
    return fallback === "all"
      ? base
      : `${base}${fallback.includes("-") ? `-${fallback.split("-")[1]}` : ""}`;
  }
  return `${base === "all" ? "en" : base}-${region}`;
}
