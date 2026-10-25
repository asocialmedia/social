// Session state for the native app. better-auth owns storage (SecureStore)
// and sliding server refresh (updateAge); this provider only shapes it for
// screens: user, pending flag, email/username sign-in, social + passkey
// sign-in, 2FA handoff, sign-out.
//
// Every sign-in is a mutation behind the install-token gate, so each one runs
// through `runWithInstallToken`: a fresh install sees the Turnstile check and
// the request resumes afterwards, and a token the server rejects is replaced
// transparently instead of surfacing as an opaque failure.

import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";

import {
  authClient,
  hasNativePasskey,
  persistBrowserSessionCookie,
} from "@/features/auth/lib/auth-client";
import {
  PASSKEY_FAILED_ERROR,
  PASSKEY_UNAVAILABLE_ERROR,
  describeAuthError,
  describeOAuthRedirectError,
  extractRedirectError,
} from "@/features/auth/lib/auth-errors";
import type { AuthErrorKind } from "@/features/auth/lib/auth-errors";
import {
  authorizationProxyUrl,
  runBrowserOAuth,
} from "@/features/auth/lib/browser-oauth";
import {
  GOOGLE_UNAVAILABLE_ERROR,
  hasNativeGoogle,
  signInWithGoogleNative,
} from "@/features/auth/lib/google-native";
import { describePasskeyFailure } from "@/features/auth/lib/passkey-errors";
import { classifySessionRefresh } from "@/features/auth/lib/session-connection";
import type { SessionRefreshResult } from "@/features/auth/lib/session-connection";
import { runSignOutFlow } from "@/features/auth/lib/sign-out-flow";
import { useInstall } from "@/features/auth/state/install";
import { clearExploreCache } from "@/features/explore/lib/explore-cache-native";
import { engagementStore } from "@/features/feed/lib/engagement-store";
import { viewBatcher } from "@/features/feed/lib/view-batcher";
import { feedCache } from "@/features/feed/state/feed-store";
import { clearHnCache } from "@/features/hackernews/lib/hn-cache-native";
import { sleep } from "@/features/media-upload/lib/retry";
import { clearMessageSession } from "@/features/messages/state/clear-message-session";
import { unregisterPushNotifications } from "@/features/notifications/lib/push";
import { logError, logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { supportsPasskeyOrigin } from "@/lib/network/api-base";
import { getApiBaseUrl, getAuthBaseUrl } from "@/lib/network/api-env";
import { createExpoPoller } from "@/lib/network/expo-poller";

export interface SessionUser {
  email: string;
  emailVerified?: boolean;
  id: string;
  image?: string | null;
  name: string;
  twoFactorEnabled?: boolean;
  username?: string | null;
}

export interface SignInFailure {
  error: string;
  kind: AuthErrorKind;
  ok: false;
}

export type SignInResult =
  | SignInFailure
  | { ok: true }
  | { ok: false; twoFactor: true }
  // The user dismissed the install verification gate (or the flow was
  // abandoned); nothing to show.
  | { cancelled: true; ok: false };

export type SocialResult =
  | SignInFailure
  | { ok: true }
  | { cancelled: true; ok: false };

export type SocialProvider = "google" | "reddit";

export interface SignOutOptions {
  reason?: string;
}

export interface SessionContextValue {
  isPending: boolean;
  isSigningOut: boolean;
  sessionId: string | null;
  signIn: (identifier: string, password: string) => Promise<SignInResult>;
  signInSocial: (provider: SocialProvider) => Promise<SocialResult>;
  signInPasskey: () => Promise<SignInResult>;
  // Re-reads the session. Anything that changes the signed-in user from
  // outside the sign-in flows (a username or email change in settings, an
  // unlinked provider) has to call this, or every surface that reads `user`
  // keeps rendering the old identity until the app restarts.
  refresh: () => Promise<SessionRefreshResult>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  user: SessionUser | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const CANCELLED: { cancelled: true; ok: false } = {
  cancelled: true,
  ok: false,
};

// Shapes a failed call for the screen. The technical detail (server code,
// raw message) only goes to the log, never to the banner.
function failure(error: unknown, fallback?: string): SignInFailure {
  const info = describeAuthError(error, fallback);
  if (info.detail) {
    logWarn("auth.server_error", { detail: info.detail, kind: info.kind });
  }
  return { error: info.message, kind: info.kind, ok: false };
}

function needsInstallToken(result: SignInResult | SocialResult): boolean {
  return !result.ok && "kind" in result && result.kind === "install-token";
}

// Runs a browser auth session while listening for the deep link that brings
// the user back. The expo client swallows that URL, so this is the only way
// to see a provider's `?error=` code. Module-level on purpose: the React
// Compiler does not analyse try/finally inside components.
async function withRedirectCapture<T>(
  run: () => Promise<T>
): Promise<{ code: string | null; result: T }> {
  const captured = { code: null as string | null };
  const subscription = Linking.addEventListener("url", ({ url }) => {
    captured.code = extractRedirectError(url) ?? captured.code;
  });
  try {
    const result = await run();
    return { code: captured.code, result };
  } finally {
    subscription.remove();
  }
}

async function refreshNativeSession(
  refetch: ReturnType<typeof authClient.useSession>["refetch"]
): Promise<SessionRefreshResult> {
  try {
    await refetch({ query: { disableCookieCache: true } });
    return classifySessionRefresh(authClient.$store.atoms.session.get());
  } catch (error) {
    logError("auth.session_refresh_failed", error);
    return { status: "unavailable" };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isPending, refetch } = authClient.useSession();
  const { runWithInstallToken } = useInstall();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const signOutFlight = useRef<Promise<void> | null>(null);

  const refreshFlight = useRef<Promise<SessionRefreshResult> | null>(null);
  const refresh = useCallback((): Promise<SessionRefreshResult> => {
    if (refreshFlight.current) {
      return refreshFlight.current;
    }
    const flight = refreshNativeSession(refetch);
    refreshFlight.current = flight;
    // oxlint-disable-next-line promise/prefer-await-to-then -- observe completion without awaiting the shared promise in this synchronous callback
    void flight.then(() => {
      refreshFlight.current = null;
    });
    return flight;
  }, [refetch]);

  // Sliding server expiry only renews when get-session is requested. Keep
  // active sessions current, pausing all polling while offline/backgrounded.
  const { user: authenticatedUser } = data ?? {};
  const authenticatedUserId = (authenticatedUser as SessionUser | undefined)
    ?.id;
  useEffect(() => {
    if (!authenticatedUserId) {
      return;
    }
    const poller = createExpoPoller({
      intervalMs: 5 * 60 * 1000,
      onPoll: async () => {
        await refresh();
      },
      skipInitialPoll: true,
    });
    poller.start();
    return () => poller.stop();
  }, [authenticatedUserId, refresh]);

  const signIn = useCallback(
    async (identifier: string, password: string): Promise<SignInResult> => {
      const value = identifier.trim();
      const method = value.includes("@") ? "email" : "username";
      const attempt = async (): Promise<SignInResult> => {
        await signOutFlight.current;
        try {
          const result =
            method === "email"
              ? await authClient.signIn.email({ email: value, password })
              : await authClient.signIn.username({ password, username: value });
          if (result.error) {
            return failure(result.error);
          }
          const dataValue = result.data as {
            twoFactorRedirect?: boolean;
          } | null;
          if (dataValue?.twoFactorRedirect) {
            return { ok: false, twoFactor: true };
          }
          logInfo("auth.sign_in", { method });
          return { ok: true };
        } catch (error) {
          logError("auth.sign_in_failed", error);
          return failure(error);
        }
      };
      const result = await runWithInstallToken(attempt, needsInstallToken);
      return result ?? CANCELLED;
    },
    [runWithInstallToken]
  );

  // Confirms a browser/deep-link flow actually minted a session (the
  // expo client resolves void on success and undefined on cancel).
  const confirmSession = useCallback(async (): Promise<SocialResult> => {
    try {
      const session = await authClient.getSession();
      if (session.data?.user) {
        logInfo("auth.social_sign_in");
        return { ok: true };
      }
      return CANCELLED;
    } catch (error) {
      logError("auth.session_confirm_failed", error);
      return failure(error);
    }
  }, []);

  // Native browser results carry both errors and cookies. Finish persistence
  // and session refresh before the login screen navigates to the feed.
  const browserSocial = useCallback(
    async (provider: SocialProvider): Promise<SocialResult> => {
      if (Platform.OS !== "web") {
        const callbackUrl = Linking.createURL("/login", {
          scheme: "asocialmedia",
        });
        const outcome = await runBrowserOAuth({
          callbackUrl,
          open: async (authorizationUrl) =>
            WebBrowser.openAuthSessionAsync(
              authorizationProxyUrl(
                getAuthBaseUrl(),
                authorizationUrl,
                await authClient.getCookie()
              ),
              callbackUrl
            ),
          persist: persistBrowserSessionCookie,
          refresh: async () => {
            await refreshFlight.current;
            const result = await refresh();
            return result.status === "valid";
          },
          request: async () => {
            const response = await authClient.signIn.social(
              {
                callbackURL: callbackUrl,
                disableRedirect: true,
                errorCallbackURL: callbackUrl,
                newUserCallbackURL: callbackUrl,
                provider,
              },
              { timeout: 20_000 }
            );
            return { error: response.error, url: response.data?.url };
          },
        });
        if (outcome.status === "complete") {
          logInfo("auth.social_sign_in", { provider });
          return { ok: true };
        }
        if (outcome.status === "cancelled") {
          return CANCELLED;
        }
        if (outcome.status === "failed") {
          return failure(outcome.error);
        }
        if (outcome.status === "redirect-error") {
          logWarn("auth.social_redirect_error", {
            code: outcome.code,
            provider,
          });
          return {
            error:
              describeOAuthRedirectError(outcome.code) ??
              "Couldn't complete sign-in. Please try again.",
            kind: "unknown",
            ok: false,
          };
        }
        return {
          error: "Couldn't restore your sign-in. Please try again.",
          kind: "unknown",
          ok: false,
        };
      }
      const { code, result } = await withRedirectCapture(async () => {
        const response = await authClient.signIn.social({
          callbackURL: "/",
          // Relative URLs become app deep links (asocialmedia://...), so a
          // failed callback lands back in the app instead of on the web
          // login page in the browser.
          errorCallbackURL: "/login",
          newUserCallbackURL: "/",
          provider,
        });
        return response;
      });
      if (result?.error) {
        return failure(result.error);
      }
      const redirectMessage = describeOAuthRedirectError(code);
      if (redirectMessage) {
        logError("auth.social_redirect_error", new Error(code ?? ""), {
          provider,
        });
        return { error: redirectMessage, kind: "unknown", ok: false };
      }
      return confirmSession();
    },
    [confirmSession, refresh]
  );

  // Native SDK flow: Google mints an ID token for our web client id and the
  // auth service verifies it directly. No browser, no redirect host.
  const nativeGoogle = useCallback(async (): Promise<SocialResult> => {
    const native = await signInWithGoogleNative();
    if ("cancelled" in native) {
      return CANCELLED;
    }
    if ("error" in native) {
      // GOOGLE_UNAVAILABLE_ERROR means the native path cannot run at all -
      // almost always a missing or mismatched Android OAuth client for this
      // build's package + signing SHA-1 (DEVELOPER_ERROR). Fall back to the
      // browser flow instead of dead-ending, so a half-configured native path
      // never costs the user Google sign-in.
      if (native.error === GOOGLE_UNAVAILABLE_ERROR) {
        logWarn("auth.google_native_fallback", { reason: "config" });
        return await browserSocial("google");
      }
      return { error: native.error, kind: "unknown", ok: false };
    }
    const result = await authClient.signIn.social({
      idToken: { token: native.idToken },
      provider: "google",
    });
    if (result?.error) {
      return failure(result.error);
    }
    return confirmSession();
  }, [browserSocial, confirmSession]);

  const signInSocial = useCallback(
    async (provider: SocialProvider): Promise<SocialResult> => {
      const attempt = async (): Promise<SocialResult> => {
        await signOutFlight.current;
        try {
          if (provider === "google" && hasNativeGoogle) {
            return await nativeGoogle();
          }
          return await browserSocial(provider);
        } catch (error) {
          logError("auth.social_sign_in_failed", error, { provider });
          return failure(error);
        }
      };
      const result = await runWithInstallToken(attempt, needsInstallToken);
      return result ?? CANCELLED;
    },
    [browserSocial, nativeGoogle, runWithInstallToken]
  );

  const signInPasskey = useCallback(async (): Promise<SignInResult> => {
    // Gate on the PLUGIN, never on `typeof signIn.passkey`. better-auth's client
    // `signIn` is a Proxy: any property access returns a callable that fires
    // `GET /sign-in/{name}`. So `typeof signIn.passkey` is always "function"
    // even when the plugin is absent (Expo Go has no native passkey module),
    // which made the old typeof guard dead code - it sent a request that 404s
    // instead of showing this message.
    const unavailable: SignInFailure = {
      error: PASSKEY_UNAVAILABLE_ERROR,
      kind: "unknown",
      ok: false,
    };
    if (!hasNativePasskey) {
      logWarn("auth.passkey_unavailable", { reason: "no native module" });
      return unavailable;
    }
    // WebAuthn needs an https relying party (and on Android an rpID with
    // assetlinks), so a dev server on http://localhost can never complete the
    // ceremony. Stop here instead of letting the native prompt fail cryptically;
    // the log carries the fix (point EXPO_PUBLIC_DEV_API_URL at prod).
    if (!supportsPasskeyOrigin(getApiBaseUrl())) {
      logWarn("auth.passkey_unavailable", {
        apiBaseUrl: getApiBaseUrl(),
        reason:
          "non-https origin; set EXPO_PUBLIC_DEV_API_URL to an https server",
      });
      return unavailable;
    }
    const { passkey } = authClient.signIn as {
      passkey?: () => Promise<{ data?: unknown; error?: unknown }>;
    };
    if (typeof passkey !== "function") {
      logWarn("auth.passkey_unavailable", { reason: "plugin missing" });
      return unavailable;
    }
    const attempt = async (): Promise<SignInResult> => {
      await signOutFlight.current;
      try {
        const result = await passkey();
        if (result?.error) {
          const described = describePasskeyFailure(result.error);
          return "cancelled" in described
            ? CANCELLED
            : failure(result.error, described.error);
        }
        const confirmed = await confirmSession();
        if (confirmed.ok) {
          logInfo("auth.passkey_sign_in");
          return { ok: true };
        }
        return { error: PASSKEY_FAILED_ERROR, kind: "unknown", ok: false };
      } catch (error) {
        const described = describePasskeyFailure(error);
        if ("cancelled" in described) {
          return CANCELLED;
        }
        logError("auth.passkey_sign_in_failed", error);
        return failure(error, described.error);
      }
    };
    const result = await runWithInstallToken(attempt, needsInstallToken);
    return result ?? CANCELLED;
  }, [confirmSession, runWithInstallToken]);

  const signOut = useCallback(
    (options?: SignOutOptions): Promise<void> => {
      if (signOutFlight.current) {
        return signOutFlight.current;
      }
      setIsSigningOut(true);
      const flight = runSignOutFlow({
        clear: () => {
          engagementStore.clear();
          viewBatcher.reset();
          feedCache.clear();
          clearExploreCache();
          clearHnCache();
          clearMessageSession();
        },
        complete: () => {
          signOutFlight.current = null;
          setIsSigningOut(false);
        },
        navigate: () =>
          router.replace({
            params: options?.reason ? { reason: options.reason } : {},
            pathname: "/(auth)/login",
          }),
        // Push unregistration needs the old cookie, before Better Auth clears it.
        revoke: async () => {
          try {
            await authClient.signOut();
          } catch (error) {
            logError("auth.sign_out_failed", error);
          }
        },
        unregister: () =>
          Promise.race([unregisterPushNotifications(), sleep(3000)]),
      });
      signOutFlight.current = flight;
      return flight;
    },
    [router]
  );

  const value = useMemo<SessionContextValue>(() => {
    const { session: rawSession, user: rawUser } = data ?? {};
    const sessionUser = rawUser as SessionUser | undefined;
    const sessionId = (rawSession as { id?: string } | undefined)?.id ?? null;
    return {
      isPending,
      isSigningOut,
      refresh,
      sessionId,
      signIn,
      signInPasskey,
      signInSocial,
      signOut,
      user: sessionUser ?? null,
    };
  }, [
    data,
    isPending,
    isSigningOut,
    refresh,
    signIn,
    signInPasskey,
    signInSocial,
    signOut,
  ]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSessionContext must be used inside <SessionProvider>");
  }
  return value;
}
