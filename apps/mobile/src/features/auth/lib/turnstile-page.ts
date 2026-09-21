// Turnstile runs only in a browser context, so on native it is hosted in a
// WebView (Cloudflare's own documented approach for mobile apps). This module
// is the pure half: it builds the page and parses the messages it posts back,
// with no React Native imports, so both are unit-testable.

/** Message shapes the page posts to the native side. */
export type TurnstileMessage =
  | { type: "ready" }
  | { type: "verify"; token: string }
  | { type: "error"; code: string }
  | { type: "expired" }
  | { type: "timeout" };

/**
 * Parses a message posted from the Turnstile WebView. Returns null for
 * anything unrecognised so a malformed message can never crash the app.
 */
export function parseTurnstileMessage(raw: unknown): TurnstileMessage | null {
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
  const { code, token, type } = parsed as Record<string, unknown>;
  switch (type) {
    case "error": {
      return { code: typeof code === "string" ? code : "unknown", type };
    }
    case "verify": {
      return typeof token === "string" && token.length > 0
        ? { token, type }
        : null;
    }
    case "expired":
    case "ready":
    case "timeout": {
      return { type };
    }
    default: {
      return null;
    }
  }
}

export type TurnstileAppearance = "always" | "execute" | "interaction-only";

/**
 * Origin the challenge page must claim.
 *
 * A Turnstile sitekey is bound to hostnames, so the page has to sit on one
 * Cloudflare recognises or the widget fails with "unable to connect to
 * website" (error 110200). Inline HTML alone has an opaque origin and no
 * hostname at all, which is why the WebView is given a real `baseUrl`.
 *
 * The origin must ALSO be accepted by the server's TURNSTILE_HOSTNAMES
 * allowlist on siteverify, so the two have to agree. Production uses the app
 * origin; development overrides this because the dev API sits on a host alias
 * (an emulator's 10.0.2.2, or a LAN address) that neither Cloudflare nor the
 * dev allowlist knows about - localhost is the one host both accept.
 */
export function resolveTurnstileBaseUrl(
  configured: string | undefined,
  apiBaseUrl: string
): string {
  const trimmed = configured?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }
  return apiBaseUrl.replace(/\/+$/, "");
}

export interface TurnstilePageOptions {
  action: string;
  appearance: TurnstileAppearance;
  sitekey: string;
}

/**
 * Embeds a value as a JS string literal. JSON.stringify already escapes quotes,
 * backslashes and control characters, and the extra pass neutralises the
 * sequences that could close the surrounding <script> element.
 */
function toScriptLiteral(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

/**
 * Builds the page that hosts the widget. Kept intentionally small: render
 * Turnstile explicitly, forward every outcome to React Native, and expose
 * reset/execute for the host to drive.
 */
export function buildTurnstilePage(options: TurnstilePageOptions): string {
  const sitekey = toScriptLiteral(options.sitekey);
  const action = toScriptLiteral(options.action);
  const appearance = toScriptLiteral(options.appearance);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #container { display: flex; justify-content: center; padding: 8px 0; }
</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>
</head>
<body>
<div id="container"></div>
<script>
  function post(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }
  function onTurnstileLoad() {
    try {
      window.turnstile.render('#container', {
        sitekey: ${sitekey},
        action: ${action},
        appearance: ${appearance},
        callback: function (token) { post({ type: 'verify', token: token }); },
        'error-callback': function (code) { post({ type: 'error', code: String(code || 'unknown') }); },
        'expired-callback': function () { post({ type: 'expired' }); },
        'timeout-callback': function () { post({ type: 'timeout' }); }
      });
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'error', code: 'render-failed' });
    }
  }
  window.asmTurnstileReset = function () {
    if (window.turnstile) { window.turnstile.reset(); }
  };
  window.asmTurnstileExecute = function () {
    if (window.turnstile) { window.turnstile.execute(); }
  };
</script>
</body>
</html>`;
}
