export function parseAuditCountry(value?: string) {
  if (!value) {
    return;
  }
  const country = value.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Audit country must be a two-letter country code");
  }
  return country;
}

export function auditCountryHeaders(
  requestUrl: string,
  origin: string,
  headers: Record<string, string>,
  country?: string
): Record<string, string> {
  if (!country || new URL(requestUrl).origin !== origin) {
    return headers;
  }
  return { ...headers, "cf-ipcountry": country };
}
