import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface RateLimitInfo {
  isLimited: boolean;
  remaining: number;
  resetTime: number;
}

interface SignupState {
  canCreate: () => boolean;
  canResend: () => boolean;

  canStartSignup: () => boolean;
  canVerify: () => boolean;
  clearRateLimit: (action: keyof SignupState["rateLimits"]) => void;
  currentEmail: string | null;
  isCreating: boolean;
  isResending: boolean;

  isStarting: boolean;
  isVerifying: boolean;
  rateLimits: {
    start: RateLimitInfo;
    resend: RateLimitInfo;
    verify: RateLimitInfo;
    create: RateLimitInfo;
  };

  reset: () => void;
  setCreating: (creating: boolean) => void;
  setCurrentEmail: (email: string | null) => void;

  setRateLimit: (
    action: keyof SignupState["rateLimits"],
    info: Partial<RateLimitInfo>
  ) => void;
  setResending: (resending: boolean) => void;
  setShowEmailVerification: (show: boolean) => void;

  setShowOTPPanel: (show: boolean) => void;

  setStarting: (starting: boolean) => void;
  setVerifying: (verifying: boolean) => void;
  showEmailVerification: boolean;

  showOTPPanel: boolean;
}

const initialRateLimit: RateLimitInfo = {
  isLimited: false,
  remaining: 0,
  resetTime: 0,
};

const initialState = {
  currentEmail: null,
  isCreating: false,
  isResending: false,
  isStarting: false,
  isVerifying: false,
  rateLimits: {
    create: { ...initialRateLimit },
    resend: { ...initialRateLimit },
    start: { ...initialRateLimit },
    verify: { ...initialRateLimit },
  },
  showEmailVerification: false,
  showOTPPanel: false,
};

export const useSignupStore = create<SignupState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      canCreate: () => {
        const { rateLimits, isCreating } = get();
        return !(isCreating || rateLimits.create.isLimited);
      },

      canResend: () => {
        const { rateLimits, isResending } = get();
        return !(isResending || rateLimits.resend.isLimited);
      },

      canStartSignup: () => {
        const { rateLimits, isStarting } = get();
        return !(isStarting || rateLimits.start.isLimited);
      },

      canVerify: () => {
        const { rateLimits, isVerifying } = get();
        return !(isVerifying || rateLimits.verify.isLimited);
      },

      clearRateLimit: (action) =>
        set((state) => ({
          rateLimits: {
            ...state.rateLimits,
            [action]: { ...initialRateLimit },
          },
        })),

      reset: () =>
        set({
          ...initialState,
          rateLimits: {
            create: { ...initialState.rateLimits.create },
            resend: { ...initialState.rateLimits.resend },
            start: { ...initialState.rateLimits.start },
            verify: { ...initialState.rateLimits.verify },
          },
        }),

      setCreating: (creating) => set({ isCreating: creating }),

      setCurrentEmail: (email) => set({ currentEmail: email }),

      setRateLimit: (action, info) =>
        set((state) => {
          const mergedLimits = {
            ...state.rateLimits[action],
            ...info,
          };
          return {
            rateLimits: {
              ...state.rateLimits,
              [action]: {
                ...mergedLimits,
                isLimited:
                  (mergedLimits.remaining ?? 0) <= 0 &&
                  (mergedLimits.resetTime ?? 0) > Date.now() / 1000,
              },
            },
          };
        }),

      setResending: (resending) => set({ isResending: resending }),

      setShowEmailVerification: (show) => set({ showEmailVerification: show }),

      setShowOTPPanel: (show) => set({ showOTPPanel: show }),

      setStarting: (starting) => set({ isStarting: starting }),

      setVerifying: (verifying) => set({ isVerifying: verifying }),
    }),
    {
      name: "signup-store",
    }
  )
);

export const useRateLimitCountdown = (
  action: keyof SignupState["rateLimits"]
) => {
  const rateLimit = useSignupStore((state) => state.rateLimits[action]);

  if (!rateLimit.isLimited || rateLimit.resetTime === 0) {
    return { isActive: false, timeLeft: 0 };
  }

  // eslint-disable-next-line react-compiler -- countdown time must be read at render time
  const now = Date.now() / 1000;
  const timeLeft = Math.max(0, Math.ceil(rateLimit.resetTime - now));

  return {
    isActive: timeLeft > 0,
    timeLeft,
  };
};
