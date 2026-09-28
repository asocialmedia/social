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
import { decideLegalNavigation } from "@/features/legal/lib/legal-navigation";
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

  // Hands a link to whichever system app can open it, and gets the reader off
  // this screen when nothing can.
  const openExternally = useCallback(
    async (target: string) => {
      try {
        await Linking.openURL(target);
      } catch {
        // A dead link must not leave the reader on a document that never opened.
        if (router.canGoBack()) {
          router.back();
          return;
        }
        router.replace("/");
      }
    },
    [router]
  );

  // Only the document itself is loaded in-app. Anything that navigates away from
  // it is a real external link, and the decision is made on the request, before
  // the load starts: a callback that only watches navigation reports the new
  // page once it is already there, which renders GitHub under this title bar
  // with no way back to the document.
  const allowNavigation = useCallback(
    (target: string, isTopFrame: boolean) => {
      const decision = decideLegalNavigation({
        apiBase,
        documentUrl: url,
        target,
      });
      if (decision === "allow") {
        return true;
      }
      // A subframe is a resource the document asked for, not a destination the
      // reader chose, so an off-origin one is dropped rather than sent to the
      // system browser.
      if (decision === "open-externally" && isTopFrame) {
        // Deliberately not awaited: the native side blocks on this callback
        // until it returns, so awaiting here would hold the navigation decision
        // open until the system browser had come up.
        void openExternally(target);
      }
      return false;
    },
    [apiBase, openExternally, url]
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <View style={styles.bar}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/");
          }}
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
          onError={() => {
            setFailed(true);
            setLoading(false);
          }}
          onLoadEnd={() => {
            setLoading(false);
          }}
          onShouldStartLoadWithRequest={(request) =>
            allowNavigation(request.url, request.isTopFrame)
          }
          // The API base is plain http in development, so this cannot be
          // narrowed to https. It is not the reader-facing gate either: every
          // navigation is decided on the request in onShouldStartLoadWithRequest.
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
