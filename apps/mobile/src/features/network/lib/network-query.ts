export interface NetworkRequestContext {
  scope: string;
  profile: string;
  locale: string;
  surface?: "home" | "explore";
}
export function appendNetworkQuery(
  path: string,
  context?: NetworkRequestContext
): string {
  if (!context) {
    return path;
  }
  const [base, raw = ""] = path.split("?", 2);
  const query = new URLSearchParams(raw);
  query.set("network", context.scope);
  query.set("profile", context.profile);
  query.set("locale", context.locale);
  if (context.surface) {
    query.set("surface", context.surface);
  }
  return `${base}?${query}`;
}
