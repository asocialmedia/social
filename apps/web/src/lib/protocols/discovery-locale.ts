import { discoveryLocaleSchema } from "@asm/protocols/discovery";
import { getCountriesForTimezone } from "countries-and-timezones";

export function resolveDiscoveryLocale(
  languages: readonly string[],
  timeZone: string,
  preference = "auto"
) {
  if (preference === "all") {
    return "all";
  }
  let selected: Intl.Locale | undefined;
  for (const value of preference === "auto"
    ? languages.slice(0, 8)
    : [preference]) {
    try {
      const locale = new Intl.Locale(value);
      if (discoveryLocaleSchema.safeParse(locale.language).success) {
        selected = locale;
        break;
      }
    } catch {
      continue;
    }
  }
  const language = selected?.language ?? "en";
  const countries = getCountriesForTimezone(timeZone).map(
    (country) => country.id
  );
  const region =
    selected?.region && countries.some((country) => country === selected.region)
      ? selected.region
      : (countries[0] ?? selected?.region);
  return region ? `${language}-${region}` : language;
}
