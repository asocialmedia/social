import { PROD_API_URL } from "@/lib/api-base";

// Public OAuth audience advertised by the production Google authorization URL.
const PRODUCTION_GOOGLE_WEB_CLIENT_ID =
  "724936986991-eqsgnln62as0ivh94csq1vtlt4e74d9q.apps.googleusercontent.com";

export function resolveGoogleWebClientId({
  apiBaseUrl,
  configuredClientId,
  development,
}: {
  apiBaseUrl: string;
  configuredClientId: string | undefined;
  development: boolean;
}): string | undefined {
  const configured = configuredClientId?.trim();
  if (configured) {
    return configured;
  }
  return !development && apiBaseUrl === PROD_API_URL
    ? PRODUCTION_GOOGLE_WEB_CLIENT_ID
    : undefined;
}
