import { describe, expect, test } from "bun:test";

import { decideLegalNavigation } from "./legal-navigation";

// The documents are rendered inside the app under a native title bar, so a
// link out of one has to be handed to the system browser and refused in the
// WebView. A regression here is GitHub rendering under "Terms & Conditions".
const API_BASE = "https://asocialmedia.cc";
const DOCUMENT = "https://asocialmedia.cc/toc";

function decide(target: string, apiBase = API_BASE) {
  return decideLegalNavigation({
    apiBase,
    documentUrl: `${apiBase}/toc`,
    target,
  });
}

describe("decideLegalNavigation", () => {
  test("allows the document itself, its in-page anchors and the API", () => {
    expect(decide(DOCUMENT)).toBe("allow");
    expect(decide("https://asocialmedia.cc/toc#dmca")).toBe("allow");
    expect(decide("https://asocialmedia.cc/api/health")).toBe("allow");
    expect(decide("about:blank")).toBe("allow");
  });

  test("hands every other origin to the system browser", () => {
    // The GitHub repository the Privacy Policy links to.
    expect(decide("https://github.com/asocialmedia/social")).toBe(
      "open-externally"
    );
    expect(decide("http://asocialmedia.cc.attacker.example/toc")).toBe(
      "open-externally"
    );
  });

  test("compares parsed origins, not string prefixes", () => {
    // Every one of these starts with the document URL, which is exactly why the
    // old prefix test let them through.
    expect(decide("https://asocialmedia.cc.attacker.example/toc")).toBe(
      "open-externally"
    );
    expect(decide("https://asocialmedia.cc.evil.example")).toBe(
      "open-externally"
    );
    expect(decide("https://evil.example/https://asocialmedia.cc")).toBe(
      "open-externally"
    );
  });

  test("separates the port, not just the host", () => {
    expect(decide("https://asocialmedia.cc:8443/toc")).toBe("open-externally");
  });

  test("works against a plain-http development API", () => {
    const dev = "http://10.0.2.2:3000";
    expect(decide("http://10.0.2.2:3000/privacy", dev)).toBe("allow");
    expect(decide("https://asocialmedia.cc/privacy", dev)).toBe(
      "open-externally"
    );
  });

  test("passes non-web schemes to the system, and blocks the rest", () => {
    expect(decide("mailto:support@asocialmedia.cc")).toBe("open-externally");
    expect(decide("tel:+15550100")).toBe("open-externally");
    // No reader-facing link in a legal document needs these, and loading them
    // in-app would be at best pointless. The javascript: case is the one that
    // matters: a WebView allowlist that lets it through runs script in the
    // document's origin.
    // oxlint-disable-next-line no-script-url -- the scheme is the subject here
    expect(decide("javascript:alert(1)")).toBe("block");
    expect(decide("data:text/html,<h1>hi</h1>")).toBe("block");
    expect(decide("blob:https://asocialmedia.cc/9f1c")).toBe("block");
    expect(decide("file:///etc/passwd")).toBe("block");
  });

  test("blocks what it cannot parse instead of guessing", () => {
    expect(decide("::::")).toBe("block");
    expect(decide("")).toBe("block");
  });
});
