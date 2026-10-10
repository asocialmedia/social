import { PROD_API_URL } from "@/lib/api-base";

// Public widget key served by the production signup page; the secret stays on the server.
const PRODUCTION_TURNSTILE_SITE_KEY = "0x4AAAAAAEuKQSsPABv2HAdA";

export function resolveTurnstileSiteKey({
  apiBaseUrl,
  configuredSiteKey,
  development,
}: {
  apiBaseUrl: string;
  configuredSiteKey: string | undefined;
  development: boolean;
}): string | undefined {
  const configured = configuredSiteKey?.trim();
  if (configured) {
    return configured;
  }
  return !development && apiBaseUrl === PROD_API_URL
    ? PRODUCTION_TURNSTILE_SITE_KEY
    : undefined;
}
