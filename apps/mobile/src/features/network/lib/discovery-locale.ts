import { discoveryLocaleSchema } from "@asm/protocols/discovery";
import type { NetworkPreferences } from "@asm/protocols/discovery";

export function discoveryLocale(
  preferences: NetworkPreferences,
  device = Intl.DateTimeFormat().resolvedOptions().locale || "en"
): string {
  const languages = preferences.contentLanguages;
  if (preferences.language === "all" || languages?.length === 0) {
    return "all";
  }
  const language =
    languages?.[0] ??
    (preferences.language === "auto"
      ? device.split("-")[0]
      : preferences.language) ??
    "en";
  const region =
    preferences.region === "auto"
      ? device.match(/-(?<region>[A-Z]{2})(?:-|$)/)?.groups?.region
      : preferences.region;
  const resolved =
    region && region !== "all" ? `${language}-${region}` : language;
  return discoveryLocaleSchema.safeParse(resolved).success ? resolved : "all";
}
