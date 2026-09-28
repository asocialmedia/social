// In-app Terms of Service and Privacy Policy.
//
// Both documents are rendered from the web app's own /toc and /privacy routes
// rather than copied into native. That is deliberate for legal text specifically:
// the copy must be identical everywhere and must be updatable in one place, and
// a second copy in this app would be a second version of the law that nobody
// remembers to change. The pages are already public, so no session is needed.
//
// The chrome is native, so this reads as a screen in the app rather than a
// browser: a titled bar with a working back control and an external-link
// escape for the handful of links the documents contain.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import {
  legalDocumentPath,
  legalDocumentTitle,
  resolveLegalDocument,
} from "@/features/legal/lib/legal-document";
import type { LegalDocument } from "@/features/legal/lib/legal-document";
import {
  LEGAL_LINK_BRIDGE_SCRIPT,
  decideLegalNavigation,
  parseLegalLinkMessage,
} from "@/features/legal/lib/legal-navigation";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

export default function LegalDocumentRoute() {
  const params = useLocalSearchParams<{ document?: string | string[] }>();
  return (
    <LegalDocumentScreen document={resolveLegalDocument(params.document)} />
  );
}

function LegalDocumentScreen({ document }: { document: LegalDocument }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const title = legalDocumentTitle(document);
  const apiBase = getApiBaseUrl();
  const url = `${apiBase}${legalDocumentPath(document)}`;

  // Back out of the document, to wherever the reader arrived from, or to the
  // feed when this screen was opened directly.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }, [router]);

  // Hands a link to whichever system app can open it, and gets the reader off
  // this screen when nothing can.
  const openExternally = useCallback(
    async (target: string) => {
      try {
        await Linking.openURL(target);
      } catch {
        // A dead link must not leave the reader on a document that never opened.
        goBack();
      }
    },
    [goBack]
  );

  // Runs the document's own exit routes. The web app is client-rendered, so
  // these links are soft navigations that never reach the WebView delegate -
  // they arrive through onMessage instead - and a hard navigation (a redirect,
  // a form post) is refused here and comes through the same way, so both paths
  // end up in one decision.
  const followLink = useCallback(
    (target: string) => {
      const decision = decideLegalNavigation({
        apiBase,
        document,
        target,
      });
      // `allow` and `block` both end the tap here: `allow` is a same-path link
      // the page handles itself, and a subframe resource is not somewhere to
      // take the reader.
      if (decision.kind === "switch-document") {
        // The other policy is a screen of this app. Replaced rather than pushed
        // so backing out of it returns where the reader came from, not to a
        // second copy of the document they just left.
        router.replace({
          params: { document: decision.document },
          pathname: "/legal/[document]",
        });
        return;
      }
      if (decision.kind === "feed") {
        // "Back to feed" and any other link to the site's home. The reader
        // asked for the feed, so they get the feed: replacing the document
        // rather than popping it would drop them wherever they opened the
        // document from - settings, or the signup form - which is not where they
        // tapped to go.
        router.replace("/");
        return;
      }
      if (decision.kind === "open-externally") {
        // Deliberately not awaited: the native side blocks on the navigation
        // callback until it returns, so awaiting here would hold that decision
        // open until the system browser had come up.
        void openExternally(target);
      }
    },
    [apiBase, document, openExternally, router]
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <View style={styles.bar}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={8}
          onPress={goBack}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: theme.inputText }]}>
            ‹ Back
          </Text>
        </Pressable>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: theme.inputText }]}
        >
          {title}
        </Text>
        <View style={styles.back} />
      </View>
      {loading && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#ff9500" />
        </View>
      ) : null}
      {failed ? (
        <View style={[styles.overlay, styles.failedOverlay]}>
          <Text style={[styles.failed, { color: theme.dividerText }]}>
            That document could not be loaded.
          </Text>
          <Pressable
            accessibilityLabel="Retry loading document"
            accessibilityRole="button"
            onPress={() => {
              setFailed(false);
              setLoading(true);
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Open in browser"
            accessibilityRole="button"
            onPress={async () => {
              try {
                await Linking.openURL(url);
              } catch {
                // Nothing sensible to do if the system browser also fails.
              }
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Open in browser</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          // Claims the taps that would leave the document before the page acts
          // on them. Without it the web app's own router takes over and renders
          // the feed inside this screen, under a legal title bar.
          injectedJavaScriptBeforeContentLoaded={LEGAL_LINK_BRIDGE_SCRIPT}
          onError={() => {
            setFailed(true);
            setLoading(false);
          }}
          onLoadEnd={() => {
            setLoading(false);
          }}
          onMessage={(event) => {
            const target = parseLegalLinkMessage(event.nativeEvent.data);
            if (target) {
              followLink(target);
            }
          }}
          onShouldStartLoadWithRequest={(request) => {
            // The backstop for navigations the bridge never sees: a redirect, a
            // form post, or a page rendered without the injected script. A
            // subframe is a resource the document asked for, not a destination
            // the reader chose, so an off-origin one is dropped silently.
            const decision = decideLegalNavigation({
              apiBase,
              document,
              target: request.url,
            });
            if (decision.kind === "allow") {
              return true;
            }
            if (request.isTopFrame) {
              followLink(request.url);
            }
            return false;
          }}
          // The API base is plain http in development, so this cannot be
          // narrowed to https. It is not the reader-facing gate either: every
          // navigation is decided in onShouldStartLoadWithRequest and onMessage.
          originWhitelist={["https://*", "http://*"]}
          pullToRefreshEnabled
          renderLoading={() => <View />}
          source={{ uri: url }}
          style={[styles.web, { backgroundColor: theme.containerBg }]}
          startInLoadingState={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { minWidth: 64, paddingVertical: 4 },
  backText: { fontFamily: "SofiaProMed", fontSize: 16 },
  bar: {
    alignItems: "center",
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  failed: {
    fontFamily: "SofiaProReg",
    fontSize: 15,
    textAlign: "center",
  },
  failedOverlay: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  overlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 52,
  },
  retry: {
    borderColor: "#ff9500",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: { color: "#ff9500", fontFamily: "SofiaProMed", fontSize: 14 },
  root: { flex: 1 },
  title: {
    flex: 1,
    fontFamily: "SofiaProBold",
    fontSize: 16,
    textAlign: "center",
  },
  web: { flex: 1 },
});
