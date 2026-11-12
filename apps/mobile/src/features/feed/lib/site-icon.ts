import { embedImageUrl } from "./link-embeds";

// Fetch only a public site's hostname, through our image proxy. The favicon
// service returns PNG, which the proxy supports even when the origin uses ICO.
export function siteIconUrl(apiBase: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return null;
    }
    const favicon = new URL("https://www.google.com/s2/favicons");
    favicon.searchParams.set("domain", parsed.hostname);
    favicon.searchParams.set("sz", "32");
    return embedImageUrl(apiBase, favicon.href);
  } catch {
    return null;
  }
}
