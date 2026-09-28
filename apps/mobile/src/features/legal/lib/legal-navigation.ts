// Deciding where a link in the legal document goes, and getting that decision
// made before the reader is somewhere they cannot get back from. No React
// Native imports, so it is unit-testable on Node.
//
// The documents are the web app's own pages, and their chrome links out in
// three different ways:
//
//   - in-page anchors, which belong to the page
//   - the cross-link to the other policy (/toc <-> /privacy)
//   - "Back to feed" to /
//   - and the GitHub repository the Privacy Policy names
//
// Only the first is a continuation of the document. A pre-navigation check
// alone is not enough for the rest: the web app is a client-rendered Next app,
// so those links are soft navigations (a history.pushState) that never reach
// the WebView delegate - iOS and Android both only report real document
// navigations, and by the time `onNavigationStateChange` fires on iOS the feed
// is already rendered under the legal title bar. So the page also reports the
// taps themselves (see LEGAL_LINK_BRIDGE_SCRIPT) and this same decision runs
// again on the native side.

import { LEGAL_DOCUMENTS } from "./legal-document";
import type { LegalDocument } from "./legal-document";

export type LegalNavigationDecision =
  // The document itself, at any anchor. Stay in the WebView.
  | { kind: "allow" }
  // The other policy. A screen of this app, not a page of this document.
  | { document: LegalDocument; kind: "switch-document" }
  // The site's own home, behind "Back to feed". A screen of this app too.
  | { kind: "feed" }
  // Somewhere this app has no screen for: off-origin, a scheme the system can
  // open, or another page of the web app - the Terms link to /support, for one.
  // Handed to the system so the reader lands on the page they tapped.
  | { kind: "open-externally" }
  // Nothing sensible to do with it, and nothing to show the reader either.
  | { kind: "block" };

// Schemes the system can open. `about:blank` is handled separately: it is the
// WebView's own neutral document rather than anything a link points at.
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** The origin the documents are served from, or null when it cannot be read. */
function apiOrigin(apiBase: string): string | null {
  try {
    const { origin } = new URL(apiBase);
    // An opaque origin ("null") is what a non-http scheme parses to.
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** A comparable path: no query, no fragment, no trailing slash. */
function pathOf(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const { pathname } = new URL(value);
    const trimmed = pathname.replace(/\/+$/, "");
    return trimmed || "/";
  } catch {
    return null;
  }
}

export function decideLegalNavigation({
  apiBase,
  document,
  target,
}: {
  // Where the API - and therefore the document - is served from.
  apiBase: string;
  // The document currently on screen.
  document: LegalDocument;
  target: string;
}): LegalNavigationDecision {
  if (target === "about:blank") {
    return { kind: "allow" };
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { kind: "block" };
  }

  if (!OPENABLE_SCHEMES.has(parsed.protocol)) {
    return { kind: "block" };
  }

  // mailto: and tel: have no origin to compare and no page to load, so they go
  // straight to whatever app the reader uses for them.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "open-externally" };
  }

  const origin = apiOrigin(apiBase);
  if (origin === null) {
    // The document itself could not be loaded either, so no target can be
    // proven to be ours. Refusing beats handing a reader's tap to a browser.
    return { kind: "block" };
  }

  // Compared as parsed origins, never as string prefixes: a prefix test accepts
  // `https://asocialmedia.cc.evil.example`, which is the whole reason this is
  // not startsWith.
  if (parsed.origin !== origin) {
    return { kind: "open-externally" };
  }

  const targetPath = pathOf(target);
  for (const [key, entry] of Object.entries(LEGAL_DOCUMENTS)) {
    if (pathOf(`${apiBase}${entry.path}`) !== targetPath) {
      continue;
    }
    return key === document
      ? { kind: "allow" }
      : { document: key as LegalDocument, kind: "switch-document" };
  }

  // The site's home is a screen of this app, so a link to it is a route change
  // and not a page load. Everything else on the origin is a page of the web app
  // that this screen has no equivalent for, and honouring the tap means opening
  // it - going back instead would drop the reader wherever they opened the
  // document from, which is not the page they asked for.
  return targetPath === pathOf(apiBase)
    ? { kind: "feed" }
    : { kind: "open-externally" };
}

/**
 * Parses what the injected bridge posts. Returns null for anything
 * unrecognised so a malformed message can never crash the screen.
 */
export function parseLegalLinkMessage(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { url } = parsed as { url?: unknown };
  return typeof url === "string" && url.length > 0 ? url : null;
}

// Installed into the document before its own scripts run, so the first tap is
// already captured. It claims a click only when the tap would leave the
// document: an in-page anchor, or a link back to the same path, is the page's
// own business and is left alone.
//
// A plain string rather than a serialised function: a release build compiles
// through Hermes, where Function.prototype.toString does not hand back
// re-evaluable source.
export const LEGAL_LINK_BRIDGE_SCRIPT = `(function () {
  if (window.__asmLegalLinkBridge) {
    return;
  }
  window.__asmLegalLinkBridge = true;
  function path(value) {
    return value.length > 1 ? value.replace(/\\/+$/, "") : value;
  }
  document.addEventListener(
    "click",
    function (event) {
      var node = event.target;
      var anchor = node && node.closest ? node.closest("a[href]") : null;
      if (!anchor) {
        return;
      }
      var href = anchor.getAttribute("href");
      if (!href || href.charAt(0) === "#") {
        return;
      }
      var resolved;
      try {
        resolved = new URL(href, window.location.href);
      } catch (error) {
        return;
      }
      if (path(resolved.pathname) === path(window.location.pathname)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ url: resolved.href })
        );
      }
    },
    true
  );
})();`;
