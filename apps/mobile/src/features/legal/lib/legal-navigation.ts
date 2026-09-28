// Deciding, before a navigation starts, whether the legal-document WebView may
// follow it. No React Native imports, so it is unit-testable on Node.
//
// The documents are the web app's own pages and they do link out: the Privacy
// Policy names the source repository, the Terms link a support address. A
// navigation callback that only observes a load cannot refuse it, so following
// one of those links loads a third-party site underneath the app's
// legal-document title bar, with no way back to the document. The decision has
// to be made on parsed origins, while the navigation is still a request, so an
// external link can be handed to the system browser and refused in-app.

/**
 * `allow`      - the document may navigate to it.
 * `open-externally` - the reader meant to leave; hand it to the system browser
 *   and refuse it in the WebView.
 * `block`      - nothing sensible to do with it, and nothing to show the reader
 *   either: an unparseable URL, or a scheme no link in a legal document needs.
 */
export type LegalNavigationDecision = "allow" | "open-externally" | "block";

// Schemes the system can open. `about:blank` is handled separately: it is the
// WebView's own neutral document rather than anything a link points at.
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Parses a base URL, or null when it is not a URL at all. */
function parseOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Whether a parsed target sits on one of the document's own origins.
 *
 * Origins are compared after parsing rather than as string prefixes: a prefix
 * test accepts `https://asocialmedia.cc.evil.example`, which is the whole
 * reason this is not `startsWith`.
 */
function isOwnOrigin(target: URL, bases: (string | undefined)[]): boolean {
  return bases.some((base) => {
    const origin = parseOrigin(base);
    // An opaque origin ("null") is what a non-http scheme parses to, so a base
    // that cannot be resolved never matches anything.
    return origin !== null && origin !== "null" && origin === target.origin;
  });
}

export function decideLegalNavigation({
  apiBase,
  documentUrl,
  target,
}: {
  // Where the API - and therefore the document - is served from.
  apiBase: string;
  documentUrl: string;
  target: string;
}): LegalNavigationDecision {
  if (target === "about:blank") {
    return "allow";
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return "block";
  }

  if (!OPENABLE_SCHEMES.has(parsed.protocol)) {
    return "block";
  }

  // mailto: and tel: have no origin to compare and no page to load, so they go
  // straight to whatever app the reader uses for them.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "open-externally";
  }

  return isOwnOrigin(parsed, [documentUrl, apiBase])
    ? "allow"
    : "open-externally";
}
