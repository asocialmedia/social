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
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { authClient, hasNativePasskey } from "@/features/auth/lib/auth-client";
import {
  PASSKEY_FAILED_ERROR,
  PASSKEY_UNAVAILABLE_ERROR,
  describeAuthError,
  describeOAuthRedirectError,
  extractRedirectError,
} from "@/features/auth/lib/auth-errors";
import type { AuthErrorKind } from "@/features/auth/lib/auth-errors";
import {
  hasNativeGoogle,
  signInWithGoogleNative,
} from "@/features/auth/lib/google-native";
import { useInstall } from "@/features/auth/state/install";
import { supportsPasskeyOrigin } from "@/lib/api-base";
import { getApiBaseUrl } from "@/lib/api-env";
import { logError, logInfo, logWarn } from "@/lib/telemetry";

export interface SessionUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
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

interface SessionContextValue {
  isPending: boolean;
  signIn: (identifier: string, password: string) => Promise<SignInResult>;
  signInSocial: (provider: SocialProvider) => Promise<SocialResult>;
  signInPasskey: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
  user: SessionUser | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const CANCELLED: { cancelled: true; ok: false } = {
  cancelled: true,
  ok: false,
};

// Shapes a failed call for the screen. The technical detail (server code,
// raw message) only goes to the log, never to the banner.
function failure(error: unknown): SignInFailure {
  const info = describeAuthError(error);
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();
  const { runWithInstallToken } = useInstall();

  const signIn = useCallback(
    async (identifier: string, password: string): Promise<SignInResult> => {
      const value = identifier.trim();
      const method = value.includes("@") ? "email" : "username";
      const attempt = async (): Promise<SignInResult> => {
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

  // Browser round-trip through the provider. The expo client opens the auth
  // session and swallows the returning deep link, so the only way to learn
  // that the provider bounced with `?error=` is to listen for the URL
  // ourselves while the browser is up (Android delivers it; iOS auth
  // sessions do not, and there we fall back to "no session => cancelled").
  const browserSocial = useCallback(
    async (provider: SocialProvider): Promise<SocialResult> => {
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
    [confirmSession]
  );

  // Native SDK flow: Google mints an ID token for our web client id and the
  // auth service verifies it directly. No browser, no redirect host.
  const nativeGoogle = useCallback(async (): Promise<SocialResult> => {
    const native = await signInWithGoogleNative();
    if ("cancelled" in native) {
      return CANCELLED;
    }
    if ("error" in native) {
      return { error: native.error, kind: "unknown", ok: false };
    }
    const result = await authClient.signIn.social({
      idToken: { accessToken: native.accessToken, token: native.idToken },
      provider: "google",
    });
    if (result?.error) {
      return failure(result.error);
    }
    return confirmSession();
  }, [confirmSession]);

  const signInSocial = useCallback(
    async (provider: SocialProvider): Promise<SocialResult> => {
      const attempt = async (): Promise<SocialResult> => {
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
      try {
        const result = await passkey();
        if (result?.error) {
          return failure(result.error);
        }
        const confirmed = await confirmSession();
        if (confirmed.ok) {
          logInfo("auth.passkey_sign_in");
          return { ok: true };
        }
        return { error: PASSKEY_FAILED_ERROR, kind: "unknown", ok: false };
      } catch (error) {
        logError("auth.passkey_sign_in_failed", error);
        return failure(error);
      }
    };
    const result = await runWithInstallToken(attempt, needsInstallToken);
    return result ?? CANCELLED;
  }, [confirmSession, runWithInstallToken]);

  const signOut = useCallback(async () => {
    try {
      await authClient.signOut();
    } catch (error) {
      logError("auth.sign_out_failed", error);
    }
    router.replace("/(auth)/login");
  }, [router]);

  const value = useMemo<SessionContextValue>(() => {
    const { user: rawUser } = data ?? {};
    const sessionUser = rawUser as SessionUser | undefined;
    return {
      isPending,
      signIn,
      signInPasskey,
      signInSocial,
      signOut,
      user: sessionUser ?? null,
    };
  }, [data, isPending, signIn, signInPasskey, signInSocial, signOut]);

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
