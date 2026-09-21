// Hosts Cloudflare Turnstile in a WebView. Turnstile only runs in a browser
// context, so this is Cloudflare's documented approach for native apps rather
// than a native SDK (none exists).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import { Spinner3D } from "@/components/feedback/spinner-3d";

import {
  buildTurnstilePage,
  parseTurnstileMessage,
} from "../lib/turnstile-page";
import type { TurnstileAppearance } from "../lib/turnstile-page";

interface TurnstileWebViewProps {
  action: string;
  appearance?: TurnstileAppearance;
  // Origin the page claims. Turnstile is hostname-bound, so the inline page
  // MUST be given a real base URL or the widget fails with 110200.
  baseUrl: string;
  onError?: (code: string) => void;
  onExpire?: () => void;
  onVerify: (token: string) => void;
  // Increment to discard the current challenge and request a fresh one.
  resetSignal?: number;
  sitekey: string;
}

export function TurnstileWebView({
  action,
  appearance = "always",
  baseUrl,
  onError,
  onExpire,
  onVerify,
  resetSignal = 0,
  sitekey,
}: TurnstileWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const [isReady, setIsReady] = useState(false);

  // Callbacks are held in a ref so a parent re-render does not rebuild the page
  // (which would discard the in-flight challenge). Updated in an effect, never
  // during render.
  const handlers = useRef({ onError, onExpire, onVerify });
  useEffect(() => {
    handlers.current = { onError, onExpire, onVerify };
  });

  const html = useMemo(
    () => buildTurnstilePage({ action, appearance, sitekey }),
    [action, appearance, sitekey]
  );

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseTurnstileMessage(event.nativeEvent.data);
    if (!message) {
      return;
    }
    switch (message.type) {
      case "ready": {
        setIsReady(true);
        break;
      }
      case "verify": {
        handlers.current.onVerify(message.token);
        break;
      }
      case "error": {
        handlers.current.onError?.(message.code);
        break;
      }
      case "expired": {
        handlers.current.onExpire?.();
        break;
      }
      case "timeout": {
        handlers.current.onError?.("timeout");
        break;
      }
      default: {
        break;
      }
    }
  }, []);

  // Reset the solved challenge so the next attempt gets a fresh token. Skips
  // the initial render, where there is nothing to reset yet.
  const previousReset = useRef(resetSignal);
  useEffect(() => {
    if (previousReset.current === resetSignal) {
      return;
    }
    previousReset.current = resetSignal;
    webViewRef.current?.injectJavaScript(
      "window.asmTurnstileReset && window.asmTurnstileReset(); true;"
    );
  }, [resetSignal]);

  return (
    <View style={styles.container}>
      <WebView
        // Cloudflare requires JS, DOM storage and a stable UA for the whole
        // challenge, and warns that an inconsistent UA fails the challenge.
        domStorageEnabled
        javaScriptEnabled
        // No navigation is expected; anything that tries is not the widget.
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith("https://challenges.cloudflare.com") ||
          request.url === "about:blank"
        }
        onMessage={handleMessage}
        originWhitelist={["https://challenges.cloudflare.com", "about:blank"]}
        ref={webViewRef}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        // `baseUrl` is what makes this work: it gives the inline page a real
        // hostname, which the domain-bound sitekey requires.
        source={{ baseUrl, html }}
        style={styles.webview}
      />
      {isReady ? null : (
        <View pointerEvents="none" style={styles.loading}>
          <Spinner3D size={44} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 78,
    position: "relative",
  },
  loading: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  webview: {
    backgroundColor: "transparent",
  },
});
