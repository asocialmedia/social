// Native replacement for the web signup URL state (nuqs ?otp=&email_verify=&email=)
// plus the zustand signup-store loading/rate-limit flags. UI-only: no network,
// no SecureStore. Screens mount inside <SignupStateProvider> and read the
// current stage from here so refresh-safe web params become in-memory stage.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type SignupStage = "form" | "otp" | "email-verify";

interface SignupStateValue {
  clearSignupState: () => void;
  currentEmail: string;
  setEmailVerificationState: (email: string) => void;
  setOTPState: (email: string) => void;
  showEmailVerification: boolean;
  showOTPPanel: boolean;
  stage: SignupStage;
}

const SignupStateContext = createContext<SignupStateValue | null>(null);

export function SignupStateProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<SignupStage>("form");
  const [currentEmail, setCurrentEmail] = useState("");

  const clearSignupState = useCallback(() => {
    setStage("form");
    setCurrentEmail("");
  }, []);

  const setOTPState = useCallback((email: string) => {
    setCurrentEmail(email);
    setStage("otp");
  }, []);

  const setEmailVerificationState = useCallback((email: string) => {
    setCurrentEmail(email);
    setStage("email-verify");
  }, []);

  const value = useMemo<SignupStateValue>(
    () => ({
      clearSignupState,
      currentEmail,
      setEmailVerificationState,
      setOTPState,
      showEmailVerification: stage === "email-verify",
      showOTPPanel: stage === "otp" || stage === "email-verify",
      stage,
    }),
    [
      clearSignupState,
      currentEmail,
      setEmailVerificationState,
      setOTPState,
      stage,
    ]
  );

  return (
    <SignupStateContext.Provider value={value}>
      {children}
    </SignupStateContext.Provider>
  );
}

export function useSignupState(): SignupStateValue {
  const value = useContext(SignupStateContext);
  if (!value) {
    throw new Error("useSignupState must be used inside <SignupStateProvider>");
  }
  return value;
}
