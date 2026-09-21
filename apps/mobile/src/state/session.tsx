// Session state for the native app. better-auth owns storage (SecureStore)
// and sliding server refresh (updateAge); this provider only shapes it for
// screens: user, pending flag, email/username sign-in, 2FA handoff, sign-out.

import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { logError, logInfo } from "@/lib/telemetry";

export interface SessionUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
  username?: string | null;
}

export type SignInResult =
  | { error: string; ok: false }
  | { ok: true }
  | { ok: false; twoFactor: true };

export type SocialResult =
  | { error: string; ok: false }
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

function toSignInError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return "Something went wrong, try again? Our bad!";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();

  const signIn = useCallback(
    async (identifier: string, password: string): Promise<SignInResult> => {
      const value = identifier.trim();
      try {
        const result = value.includes("@")
          ? await authClient.signIn.email({ email: value, password })
          : await authClient.signIn.username({ password, username: value });
        if (result.error) {
          return { error: toSignInError(result.error), ok: false };
        }
        const dataValue = result.data as { twoFactorRedirect?: boolean } | null;
        if (dataValue?.twoFactorRedirect) {
          return { ok: false, twoFactor: true };
        }
        logInfo("auth.sign_in", {
          method: value.includes("@") ? "email" : "username",
        });
        return { ok: true };
      } catch (error) {
        logError("auth.sign_in_failed", error);
        return { error: toSignInError(error), ok: false };
      }
    },
    []
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
      return { cancelled: true, ok: false };
    } catch (error) {
      logError("auth.session_confirm_failed", error);
      return { error: toSignInError(error), ok: false };
    }
  }, []);

  const signInSocial = useCallback(
    async (provider: SocialProvider): Promise<SocialResult> => {
      try {
        const result = await authClient.signIn.social({
          callbackURL: "/",
          provider,
        });
        if (result?.error) {
          return { error: toSignInError(result.error), ok: false };
        }
        return await confirmSession();
      } catch (error) {
        logError("auth.social_sign_in_failed", error, { provider });
        return { error: toSignInError(error), ok: false };
      }
    },
    [confirmSession]
  );

  const signInPasskey = useCallback(async (): Promise<SignInResult> => {
    const { passkey } = authClient.signIn as {
      passkey?: () => Promise<{ data?: unknown; error?: unknown }>;
    };
    if (typeof passkey !== "function") {
      return {
        error:
          "Passkeys need the release build on this device. Log in with email instead.",
        ok: false,
      };
    }
    try {
      const result = await passkey();
      if (result?.error) {
        return { error: toSignInError(result.error), ok: false };
      }
      const confirmed = await confirmSession();
      if (confirmed.ok) {
        logInfo("auth.passkey_sign_in");
        return { ok: true };
      }
      return { error: "Couldn't sign in with a passkey.", ok: false };
    } catch (error) {
      logError("auth.passkey_sign_in_failed", error);
      return { error: toSignInError(error), ok: false };
    }
  }, [confirmSession]);

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
