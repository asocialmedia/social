// Owns the install credential's lifecycle for the app.
//
// A mutating request needs a signed install token. Callers await
// `ensureToken()` before submitting; when no token is stored, that surfaces the
// Turnstile verification gate instead of blocking the whole app at launch -
// reading feeds and browsing stay unaffected.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  /** Dismisses the gate without verifying. */
  dismissGate: () => void;
  /**
   * Resolves true when a token is available. When none is stored it opens the
   * gate and returns false, so the caller aborts and the user retries after
   * verifying.
   */
  ensureToken: () => Promise<boolean>;
  /** Called by the gate once Turnstile yields a token. */
  submitVerification: (turnstileToken: string) => Promise<boolean>;
  /** Discards a token the API rejected, then reopens the gate. */
  invalidate: () => Promise<void>;
  status: InstallStatus;
}

const InstallContext = createContext<InstallContextValue | null>(null);

export function InstallProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<InstallStatus>("loading");
  const [isGateVisible, setIsGateVisible] = useState(false);

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
    };
  }, []);

  const ensureToken = useCallback(async (): Promise<boolean> => {
    if (peekInstallToken()) {
      setStatus("ready");
      return true;
    }
    const token = await loadInstallToken();
    if (token) {
      setStatus("ready");
      return true;
    }
    setStatus("needs-verification");
    setIsGateVisible(true);
    return false;
  }, []);

  const submitVerification = useCallback(
    async (turnstileToken: string): Promise<boolean> => {
      setStatus("verifying");
      const credentials = await registerInstall(turnstileToken);
      setStatus(credentials ? "ready" : "failed");
      if (credentials) {
        setIsGateVisible(false);
      }
      return credentials !== null;
    },
    []
  );

  const dismissGate = useCallback(() => {
    setIsGateVisible(false);
  }, []);

  const invalidate = useCallback(async () => {
    await clearInstallToken();
    setStatus("needs-verification");
    setIsGateVisible(true);
  }, []);

  const value = useMemo<InstallContextValue>(
    () => ({
      dismissGate,
      ensureToken,
      invalidate,
      isGateVisible,
      status,
      submitVerification,
    }),
    [
      dismissGate,
      ensureToken,
      invalidate,
      isGateVisible,
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
