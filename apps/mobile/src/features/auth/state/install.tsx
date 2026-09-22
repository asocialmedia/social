// Owns the install credential's lifecycle for the app.
//
// Most mutating requests need a signed install token; signing in does not
// (the web proxy exempts the sign-in family, so the only human check a user
// ever sees is Turnstile at signup). Callers wrap requests in
// `runWithInstallToken`, which is reactive: the request is sent with whatever
// token is stored (possibly none), and only when the server answers
// install-token-required does the Turnstile gate appear, after which the
// request is retried once. A token the server rejects is discarded first, so
// a stale install heals itself. Browsing never pays the cost.

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

import {
  clearInstallToken,
  loadInstallToken,
  peekInstallToken,
  registerInstall,
} from "@/lib/install-credentials";

export type InstallStatus =
  | "loading"
  | "ready"
  | "needs-verification"
  | "verifying"
  | "failed";

interface InstallContextValue {
  /** True when the verification gate should be on screen. */
  isGateVisible: boolean;
  /** Dismisses the gate without verifying; pending requests give up. */
  dismissGate: () => void;
  /**
   * Resolves true when a token is available. When none is stored it opens the
   * gate and returns false, so the caller aborts and the user retries after
   * verifying. Prefer `runWithInstallToken`, which retries for the caller.
   */
  ensureToken: () => Promise<boolean>;
  /**
   * Runs a mutating request under the install credential. The request goes
   * out immediately with any stored token; when the server demands one
   * (`isTokenRejected`) the stored token is discarded, the gate opens, and
   * the request is retried once after verification. Resolves null when the
   * user dismisses the gate.
   */
  runWithInstallToken: <T>(
    action: () => Promise<T>,
    isTokenRejected: (result: T) => boolean
  ) => Promise<T | null>;
  /** Called by the gate once Turnstile yields a token. */
  submitVerification: (turnstileToken: string) => Promise<boolean>;
  /** Discards a token the API rejected, then reopens the gate. */
  invalidate: () => Promise<void>;
  status: InstallStatus;
}

const InstallContext = createContext<InstallContextValue | null>(null);

type VerificationWaiter = (verified: boolean) => void;

export function InstallProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<InstallStatus>("loading");
  const [isGateVisible, setIsGateVisible] = useState(false);
  // Requests parked on the gate. Settled true when verification succeeds,
  // false when the user dismisses (or the provider unmounts).
  const waitersRef = useRef<VerificationWaiter[]>([]);
  // Counts verification attempts. Dismissing the gate bumps it, so a
  // `registerInstall` that was already in flight is recognised as stale when
  // it resolves and its result is ignored - dismissal keeps meaning
  // cancellation even if the request later succeeds.
  const verifyAttemptRef = useRef(0);

  const settleWaiters = useCallback((verified: boolean) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) {
      resolve(verified);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await loadInstallToken();
      if (active) {
        setStatus(token ? "ready" : "needs-verification");
      }
    })();
    return () => {
      active = false;
      settleWaiters(false);
    };
  }, [settleWaiters]);

  const openGate = useCallback(() => {
    setStatus("needs-verification");
    setIsGateVisible(true);
  }, []);

  const awaitVerification = useCallback(
    () =>
      // oxlint-disable-next-line promise/avoid-new -- the gate is user-driven UI, not a library call; parking the caller on a resolver is the whole point
      new Promise<boolean>((resolve) => {
        waitersRef.current.push(resolve);
        openGate();
      }),
    [openGate]
  );

  const hasToken = useCallback(async (): Promise<boolean> => {
    if (peekInstallToken()) {
      return true;
    }
    return (await loadInstallToken()) !== null;
  }, []);

  const ensureToken = useCallback(async (): Promise<boolean> => {
    if (await hasToken()) {
      setStatus("ready");
      return true;
    }
    openGate();
    return false;
  }, [hasToken, openGate]);

  const runWithInstallToken = useCallback(
    async <T,>(
      action: () => Promise<T>,
      isTokenRejected: (result: T) => boolean
    ): Promise<T | null> => {
      const result = await action();
      if (!isTokenRejected(result)) {
        return result;
      }
      // Either no token yet, or the server refused the one we hold (rotated
      // secret, install older than the token lifetime). Start over.
      await clearInstallToken();
      if (!(await awaitVerification())) {
        return null;
      }
      return action();
    },
    [awaitVerification]
  );

  const submitVerification = useCallback(
    async (turnstileToken: string): Promise<boolean> => {
      const attempt = verifyAttemptRef.current + 1;
      verifyAttemptRef.current = attempt;
      setStatus("verifying");
      const credentials = await registerInstall(turnstileToken);
      if (verifyAttemptRef.current !== attempt) {
        // Dismissed while verifying: the persisted credential (if any) stays
        // stored for next time, but this dismissal already reported
        // cancellation, so the late result must not flip the provider ready.
        return false;
      }
      setStatus(credentials ? "ready" : "failed");
      if (credentials) {
        setIsGateVisible(false);
        settleWaiters(true);
      }
      return credentials !== null;
    },
    [settleWaiters]
  );

  const dismissGate = useCallback(() => {
    // Invalidate any in-flight verification (see submitVerification).
    verifyAttemptRef.current += 1;
    setIsGateVisible(false);
    // A dismissal during verification must not leave the provider stuck
    // reporting "verifying" with the gate gone.
    setStatus((current) =>
      current === "verifying" ? "needs-verification" : current
    );
    settleWaiters(false);
  }, [settleWaiters]);

  const invalidate = useCallback(async () => {
    await clearInstallToken();
    openGate();
  }, [openGate]);

  const value = useMemo<InstallContextValue>(
    () => ({
      dismissGate,
      ensureToken,
      invalidate,
      isGateVisible,
      runWithInstallToken,
      status,
      submitVerification,
    }),
    [
      dismissGate,
      ensureToken,
      invalidate,
      isGateVisible,
      runWithInstallToken,
      status,
      submitVerification,
    ]
  );

  return (
    <InstallContext.Provider value={value}>{children}</InstallContext.Provider>
  );
}

export function useInstall(): InstallContextValue {
  const value = useContext(InstallContext);
  if (!value) {
    throw new Error("useInstall must be used inside <InstallProvider>");
  }
  return value;
}
