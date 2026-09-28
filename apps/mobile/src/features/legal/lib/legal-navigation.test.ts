import { describe, expect, test } from "bun:test";

import {
  LEGAL_LINK_BRIDGE_SCRIPT,
  decideLegalNavigation,
  parseLegalLinkMessage,
} from "./legal-navigation";

// The documents carry four kinds of link: in-page anchors, the cross-link to the
// other policy, "Back to feed" to /, and the repository the Privacy Policy
// names. Only the first is a continuation of the document; a regression here
// renders the web feed under the legal-document title bar, with the title still
// claiming it is the Terms.
const API_BASE = "https://asocialmedia.cc";

function decide(
  target: string,
  document: "privacy" | "terms" = "terms",
  apiBase = API_BASE
) {
  return decideLegalNavigation({ apiBase, document, target });
}

describe("decideLegalNavigation", () => {
  test("allows the document itself, its anchors and its trailing slash", () => {
    expect(decide(`${API_BASE}/toc`)).toEqual({ kind: "allow" });
    expect(decide(`${API_BASE}/toc#dmca`)).toEqual({ kind: "allow" });
    expect(decide(`${API_BASE}/toc?utm=1`)).toEqual({ kind: "allow" });
    expect(decide(`${API_BASE}/toc/`)).toEqual({ kind: "allow" });
    expect(decide("about:blank")).toEqual({ kind: "allow" });
  });

  test("sends the cross-link to the other policy as a screen of this app", () => {
    // Both documents live on one origin, so an origin check alone would load
    // the Privacy Policy inside the Terms screen.
    expect(decide(`${API_BASE}/privacy`)).toEqual({
      document: "privacy",
      kind: "switch-document",
    });
    expect(decide(`${API_BASE}/privacy`, "privacy")).toEqual({ kind: "allow" });
    expect(decide(`${API_BASE}/toc#contact`, "privacy")).toEqual({
      document: "terms",
      kind: "switch-document",
    });
  });

  test("refuses to page anywhere else on the site's own origin", () => {
    // "Back to feed" is a next/link to /, and the web app takes it as a soft
    // navigation, so it never reaches a pre-navigation check at all.
    expect(decide(`${API_BASE}/`)).toEqual({ kind: "leave" });
    expect(decide(`${API_BASE}`)).toEqual({ kind: "leave" });
    expect(decide(`${API_BASE}/u/someone`)).toEqual({ kind: "leave" });
    expect(decide(`${API_BASE}/api/health`)).toEqual({ kind: "leave" });
  });

  test("hands every other origin to the system browser", () => {
    // The repository the Privacy Policy links to.
    expect(decide("https://github.com/asocialmedia/social")).toEqual({
      kind: "open-externally",
    });
    expect(decide("http://asocialmedia.cc.attacker.example/toc")).toEqual({
      kind: "open-externally",
    });
  });

  test("compares parsed origins, not string prefixes", () => {
    // Every one of these starts with the document URL, which is exactly why the
    // old prefix test let them through.
    expect(decide("https://asocialmedia.cc.attacker.example/toc")).toEqual({
      kind: "open-externally",
    });
    expect(decide("https://asocialmedia.cc.evil.example")).toEqual({
      kind: "open-externally",
    });
    expect(decide("https://evil.example/https://asocialmedia.cc")).toEqual({
      kind: "open-externally",
    });
  });

  test("separates the port, not just the host", () => {
    expect(decide("https://asocialmedia.cc:8443/toc")).toEqual({
      kind: "open-externally",
    });
  });

  test("works against a plain-http development API", () => {
    const dev = "http://10.0.2.2:3000";
    expect(decide("http://10.0.2.2:3000/toc", "terms", dev)).toEqual({
      kind: "allow",
    });
    expect(decide("http://10.0.2.2:3000/privacy", "terms", dev)).toEqual({
      document: "privacy",
      kind: "switch-document",
    });
    expect(decide("http://10.0.2.2:3000/", "terms", dev)).toEqual({
      kind: "leave",
    });
    expect(decide("https://asocialmedia.cc/toc", "terms", dev)).toEqual({
      kind: "open-externally",
    });
  });

  test("passes non-web schemes to the system, and blocks the rest", () => {
    expect(decide("mailto:support@asocialmedia.cc")).toEqual({
      kind: "open-externally",
    });
    expect(decide("tel:+15550100")).toEqual({ kind: "open-externally" });
    // No reader-facing link in a legal document needs these, and loading them
    // in-app would be at best pointless. The javascript: case is the one that
    // matters: a WebView allowlist that lets it through runs script in the
    // document's origin.
    // oxlint-disable-next-line no-script-url -- the scheme is the subject here
    expect(decide("javascript:alert(1)")).toEqual({ kind: "block" });
    expect(decide("data:text/html,<h1>hi</h1>")).toEqual({ kind: "block" });
    expect(decide("blob:https://asocialmedia.cc/9f1c")).toEqual({
      kind: "block",
    });
    expect(decide("file:///etc/passwd")).toEqual({ kind: "block" });
  });

  test("blocks what it cannot parse instead of guessing", () => {
    expect(decide("::::")).toEqual({ kind: "block" });
    expect(decide("")).toEqual({ kind: "block" });
  });

  test("blocks everything when the API base itself is unreadable", () => {
    // Nothing can be proven to be ours, and the document could not have loaded
    // either, so a tap must not be handed to a browser.
    expect(decide(`${API_BASE}/toc`, "terms", "not a url")).toEqual({
      kind: "block",
    });
  });
});

describe("parseLegalLinkMessage", () => {
  test("reads the url the bridge posts", () => {
    expect(
      parseLegalLinkMessage(JSON.stringify({ url: "https://asocialmedia.cc/" }))
    ).toBe("https://asocialmedia.cc/");
  });

  test("ignores anything else that arrives on the channel", () => {
    expect(parseLegalLinkMessage("not json")).toBeNull();
    expect(parseLegalLinkMessage(JSON.stringify({ kind: "other" }))).toBeNull();
    expect(parseLegalLinkMessage(JSON.stringify({ url: 42 }))).toBeNull();
    expect(parseLegalLinkMessage(JSON.stringify({ url: "" }))).toBeNull();
    expect(parseLegalLinkMessage(null)).toBeNull();
  });
});

// The bridge is the only thing standing between a tap on "Back to feed" and the
// web app's own router, so it is exercised for real against a stub document
// rather than asserted on as a string.
interface BridgeEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  target: { closest: (selector: string) => unknown } | null;
}

function mountBridge(): {
  click: (event: BridgeEvent) => void;
  posted: string[];
} {
  const listeners: ((event: BridgeEvent) => void)[] = [];
  const posted: string[] = [];
  const addEventListener = (
    type: string,
    handler: (event: BridgeEvent) => void
  ) => {
    if (type === "click") {
      listeners.push(handler);
    }
  };
  Object.assign(globalThis, {
    document: { addEventListener },
    window: {
      ReactNativeWebView: {
        postMessage: (data: string) => {
          posted.push(data);
        },
      },
      location: { href: `${API_BASE}/toc`, pathname: "/toc" },
    },
  });
  // oxlint-disable-next-line no-new-func -- the script under test is a string by design
  new Function(LEGAL_LINK_BRIDGE_SCRIPT)();
  return {
    click: (event) => {
      for (const handler of listeners) {
        handler(event);
      }
    },
    posted,
  };
}

// The script does node.closest("a[href]") and then reads href off the result, so
// the fake target hands back a fake anchor from closest().
function anchor(href: string | null) {
  return {
    closest: () =>
      href === null
        ? null
        : { getAttribute: (name: string) => (name === "href" ? href : null) },
  };
}

function clickOn(href: string | null, bridge = mountBridge()) {
  const flags = { prevented: false, stopped: false };
  bridge.click({
    preventDefault: () => {
      flags.prevented = true;
    },
    stopPropagation: () => {
      flags.stopped = true;
    },
    target: anchor(href),
  } as unknown as BridgeEvent);
  return { posted: bridge.posted, ...flags };
}

describe("LEGAL_LINK_BRIDGE_SCRIPT", () => {
  test("claims a link that would leave the document", () => {
    // The reported case: a soft navigation the WebView delegate never sees.
    const result = clickOn("/");
    expect(result.posted).toEqual([JSON.stringify({ url: `${API_BASE}/` })]);
    expect(result.prevented).toBe(true);
  });

  test("claims the cross-link and resolves it against the page", () => {
    const relative = clickOn("../privacy");
    expect(relative.posted).toEqual([
      JSON.stringify({ url: `${API_BASE}/privacy` }),
    ]);
    const absolute = clickOn("https://github.com/asocialmedia/social");
    expect(absolute.posted).toEqual([
      JSON.stringify({ url: "https://github.com/asocialmedia/social" }),
    ]);
  });

  test("leaves the page's own links alone", () => {
    // In-page anchors and same-path links are the document scrolling, and
    // claiming them would break the contents rail.
    expect(clickOn("#dmca").posted).toEqual([]);
    expect(clickOn("#dmca").prevented).toBe(false);
    expect(clickOn("/toc").posted).toEqual([]);
    expect(clickOn("/toc#top").posted).toEqual([]);
    expect(clickOn("/toc/").posted).toEqual([]);
    expect(clickOn(null).posted).toEqual([]);
  });

  test("installs once, so a second injection cannot double-post", () => {
    const bridge = mountBridge();
    // oxlint-disable-next-line no-new-func -- the script under test is a string by design
    new Function(LEGAL_LINK_BRIDGE_SCRIPT)();
    expect(clickOn("/", bridge).posted).toHaveLength(1);
  });
});
