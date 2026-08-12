"use client";

import { type SignUpValues, signUpSchema } from "@asm/auth/validation";
import { useVerification } from "@asm/ui/providers/verification";
import { Button } from "@asm/ui/shadui/button";
import { Checkbox } from "@asm/ui/shadui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@asm/ui/shadui/input-otp";
import {
  useRateLimitCountdown,
  useSignupStore,
} from "@asm/ui/store/signup-store";
import { zodResolver } from "@hookform/resolvers/zod";
import { env } from "@root/env";
import { AlertCircle, ArrowLeft, Mail, User } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  type ControllerRenderProps,
  type FieldValues,
  type SubmitErrorHandler,
  useForm,
} from "react-hook-form";
import { useCountdown } from "usehooks-ts";
import { signUp } from "@/app/(auth)/signup/actions";
import { LoadingButton } from "@/components/auth/loading-button";
import { PasswordInput } from "@/components/auth/password-input";
import { useSignupUrlState } from "@/hooks/use-signup-url-state";
import { useToast } from "@/lib/gooey-toast";
import { PasswordStrengthChecker } from "./password-strength-checker";

const DIGITS_ONLY_REGEX = /^\d*$/;
const OTP_SLOT_IDS = [
  "slot-0",
  "slot-1",
  "slot-2",
  "slot-3",
  "slot-4",
  "slot-5",
];

interface ErrorWithMessage {
  message: string;
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
  if (isErrorWithMessage(maybeError)) {
    return maybeError;
  }
  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    return new Error(String(maybeError));
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ignore
export default function SignUpForm() {
  const { toast } = useToast();
  const { setIsVerifying } = useVerification();
  const ageVerifyId = useId();
  const termsId = useId();
  const [error, setError] = useState<string>();
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // URL-based state for UI panels (persisted across refreshes)
  const {
    showOTPPanel,
    showEmailVerification,
    currentEmail,
    clearSignupState,
    setOTPState,
    setEmailVerificationState,
  } = useSignupUrlState();

  // Zustand store for loading states and rate limiting
  const {
    isStarting,
    isResending,
    isVerifying: isVerifyingOTP,
    setStarting,
    setResending,
    setVerifying,
    setRateLimit,
    canStartSignup,
    canResend,
    reset: resetStore,
  } = useSignupStore();

  const startCountdownInfo = useRateLimitCountdown("start");
  const resendCountdownInfo = useRateLimitCountdown("resend");

  const [count, { startCountdown, stopCountdown, resetCountdown }] =
    useCountdown({
      countStart: 300,
      intervalMs: 1000,
    });
  const [
    _resendCount,
    {
      startCountdown: startResendCountdown,
      resetCountdown: resetResendCountdown,
    },
  ] = useCountdown({
    countStart: 60,
    intervalMs: 1000,
  });
  const [
    otpResendCount,
    {
      startCountdown: startOtpResendCountdown,
      resetCountdown: resetOtpResendCountdown,
    },
  ] = useCountdown({
    countStart: 30,
    intervalMs: 1000,
  });
  const verificationChannel = useRef<BroadcastChannel | null>(null);

  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
    },
    mode: "onBlur",
  });

  useEffect(() => {
    verificationChannel.current = new BroadcastChannel("email-verification");

    const handleVerificationSuccess = () => {
      setIsVerifying(false);
      window.location.reload();
    };

    verificationChannel.current.addEventListener("message", (event) => {
      if (event.data === "verification-success") {
        handleVerificationSuccess();
      }
    });

    return () => {
      if (verificationChannel.current) {
        verificationChannel.current.close();
      }
      resetStore();
    };
  }, [setIsVerifying, resetStore]);

  useEffect(() => {
    if (showOTPPanel && !showEmailVerification) {
      startCountdown();
      startOtpResendCountdown();
    } else if (!showOTPPanel) {
      stopCountdown();
      resetCountdown();
      resetOtpResendCountdown();
      setOtp("");
    }
  }, [
    showOTPPanel,
    showEmailVerification,
    startCountdown,
    stopCountdown,
    resetCountdown,
    startOtpResendCountdown,
    resetOtpResendCountdown,
  ]);

  const handleInvalidSubmit: SubmitErrorHandler<FieldValues> = useCallback(
    (errors) => {
      const [firstError] = Object.values(errors);
      const errorMessage =
        (firstError?.message as string) || "Please check your input";

      toast({
        variant: "destructive",
        title: "Oopsie daisy!",
        description: errorMessage,
        duration: 3000,
      });

      const [firstErrorField] = Object.keys(errors);
      if (firstErrorField) {
        scrollToError(firstErrorField);
      }
    },
    [toast]
  );

  const handleAgeVerifyChange = useCallback((checked: boolean) => {
    setIsAgeVerified(checked);
  }, []);

  const handleTermsChange = useCallback((checked: boolean) => {
    setAcceptedTerms(checked);
  }, []);

  const handlePasswordChange = useCallback(
    (field: ControllerRenderProps<SignUpValues, "password">) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        field.onChange(event);
        setPassword(event.target.value);
      },
    []
  );

  const renderUsernameField = useCallback(
    ({ field }: { field: ControllerRenderProps<SignUpValues, "username"> }) => (
      <FormItem>
        <FormLabel>Username</FormLabel>
        <FormControl>
          <div className="relative">
            <Input
              placeholder="cooluser"
              {...field}
              autoComplete="username"
              className="transition-all duration-500 ease-in-out"
              name="username"
            />
            <User className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    []
  );

  const renderEmailField = useCallback(
    ({ field }: { field: ControllerRenderProps<SignUpValues, "email"> }) => (
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <div className="relative">
            <Input
              placeholder="you@example.com"
              type="email"
              {...field}
              autoComplete="email"
              className="transition-all duration-500 ease-in-out"
              name="email"
            />
            <Mail className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    []
  );

  const renderPasswordField = useCallback(
    ({ field }: { field: ControllerRenderProps<SignUpValues, "password"> }) => (
      <FormItem>
        <FormLabel>Password</FormLabel>
        <FormControl>
          <PasswordInput
            placeholder="••••••••"
            {...field}
            autoComplete="new-password"
            className="transition-all duration-500 ease-in-out"
            name="password"
            onChange={handlePasswordChange(field)}
          />
        </FormControl>
        <PasswordStrengthChecker password={password} />
        <FormMessage />
      </FormItem>
    ),
    [handlePasswordChange, password]
  );

  const onSubmit = (values: SignUpValues) => {
    setError(undefined);
    if (!(isAgeVerified && acceptedTerms)) {
      toast({
        variant: "destructive",
        title: "Hold up!",
        description:
          "You gotta check those boxes, we can't let just anyone join the squad!",
        duration: 3000,
      });
      return;
    }

    if (!canStartSignup()) {
      toast({
        variant: "destructive",
        title: "Too Fast!",
        description: `You've reached the signup limit. Try again in ${startCountdownInfo.timeLeft} seconds.`,
        duration: 3000,
      });
      return;
    }

    setStarting(true);
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: signup flow requires comprehensive error handling
    startTransition(async () => {
      try {
        setIsLoading(true);
        const result = await signUp(values);

        if (result.success) {
          if (result.requiresEmailVerification === false) {
            const { authClient } = await import("@/lib/auth");
            const loginResult = await authClient.signIn.email({
              email: values.email,
              password: values.password,
              callbackURL: "/",
              fetchOptions: {
                onError: () => {
                  // handled below with fallback redirect
                },
              },
            });

            if (loginResult?.data) {
              setRateLimit("start", { isLimited: false });
              toast({
                title: "Welcome to Asocialmedia!",
                description: "Account created and signed in, welcome!",
              });
              window.location.href = "/";
              return;
            }

            toast({
              title: "Account Created!",
              description: "Your account is ready, please log in to continue.",
            });
            window.location.href = "/login";
            return;
          }

          setOTPState(values.email);
          setRateLimit("start", { isLimited: false });
          toast({
            title: "Check Your Email!",
            description: "We've sent a verification code to your email.",
          });
        } else if (result.rateLimited && result.rateLimitInfo) {
          setRateLimit("start", {
            remaining: result.rateLimitInfo.remaining,
            resetTime: result.rateLimitInfo.resetTime,
            isLimited: true,
          });

          const { resetTime } = result.rateLimitInfo;
          const now = Math.floor(Date.now() / 1000);
          const waitTime = resetTime
            ? Math.max(0, Math.ceil((resetTime - now) / 60))
            : 60;

          const rateLimitMessage =
            waitTime > 0
              ? `You've been creating accounts too quickly. Please take a ${waitTime}-minute break and try again.`
              : "Too many signup attempts. Please wait a moment and try again.";

          setError(rateLimitMessage);
          toast({
            variant: "destructive",
            title: "Rate Limited",
            description: rateLimitMessage,
            duration: 8000,
          });
        } else if (result.error) {
          const msg = String(result.error);
          setError(msg);
          toast({
            variant: "destructive",
            title: "Signup Failed!",
            description: msg,
          });
        }
      } catch (signupError) {
        const errorMessage = toErrorWithMessage(signupError).message;
        console.error("Signup error:", signupError);
        setError(errorMessage);
        toast({
          variant: "destructive",
          title: "Something went wrong!",
          description:
            process.env.NODE_ENV === "development"
              ? errorMessage
              : "An unexpected error occurred, try again? Our bad!",
        });
      } finally {
        setIsLoading(false);
        setStarting(false);
      }
    });
  };

  const handleOTPVerification = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: it's fine
    async (otpValue: string) => {
      try {
        setVerifying(true);
        setOtpError(false);
        const email = currentEmail || form.getValues("email");
        const authBase = env.NEXT_PUBLIC_AUTH_URL;
        const res = await fetch(`${authBase}/api/trpc/pendingSignupVerify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            id: 1,
            json: {
              email,
              otp: otpValue,
              otpVerified: true,
            },
          }),
        });

        const data = await res.json().catch(() => ({}) as unknown);

        if (!(res.ok && data?.result?.data?.json?.success)) {
          const serverError =
            data?.result?.error?.message ||
            data?.result?.data?.json?.error ||
            "Signup completion failed";

          const rateLimitInfo = data?.result?.data?.json;

          let userFriendlyError = "Something went wrong. Please try again.";
          let errorTitle = "Verification Failed";

          if (serverError === "invalid-otp") {
            userFriendlyError =
              "The verification code is incorrect or has expired. Please check and try again.";
            errorTitle = "Wrong Code";
            setOtpError(true);
            setOtp("");
          } else if (serverError === "user-exists") {
            userFriendlyError =
              "An account with this email or username already exists.";
            errorTitle = "Account Already Exists";
            clearSignupState();
            setTimeout(() => {
              window.location.href = "/login";
            }, 2000);
          } else if (serverError === "no-pending-signup") {
            userFriendlyError =
              "Your verification session has expired. Please start the signup process again.";
            errorTitle = "Session Expired";
            clearSignupState();
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          } else if (serverError === "rate-limited") {
            const resetTime = rateLimitInfo?.resetTime;
            const now = Math.floor(Date.now() / 1000);
            const waitTime = resetTime
              ? Math.max(0, Math.ceil((resetTime - now) / 60))
              : 60;

            userFriendlyError =
              waitTime > 0
                ? `You've been creating accounts too quickly. Please take a ${waitTime}-minute break and try again.`
                : "Too many signup attempts. Please wait a moment and try again.";
            errorTitle = "Rate Limited";
            setOtpError(true);
            setOtp("");
          }

          console.error("OTP verification error:", serverError);
          toast({
            variant: "destructive",
            title: errorTitle,
            description: userFriendlyError,
            duration: serverError === "rate-limited" ? 8000 : 5000,
          });
          return;
        }

        const responseData = data?.result?.data?.json;
        const responseEmail = responseData?.email;
        const responsePassword = form.getValues("password");

        if (responseEmail && responsePassword) {
          try {
            console.log("Attempting auto-login after OTP verification");
            const { authClient } = await import("@/lib/auth");

            const loginResult = await authClient.signIn.email({
              email: responseEmail,
              password: responsePassword,
              callbackURL: "/",
              fetchOptions: {
                onSuccess: () => {
                  console.log("Auto-login successful");
                },
                onError: (ctx) => {
                  console.error("Auto-login error:", ctx.error);
                  throw new Error(ctx.error.message || "Auto-login failed");
                },
              },
            });

            if (loginResult?.data) {
              console.log("Auto-login completed successfully");
              verificationChannel.current?.postMessage("verification-success");
              setIsVerifying(true);
              clearSignupState();
              toast({
                title: "Welcome to Asocialmedia!",
                description:
                  "Your account has been created and you're now logged in.",
              });

              await new Promise((resolve) => setTimeout(resolve, 500));
              window.location.href = "/";
              return;
            }
          } catch (signError) {
            console.error("Auto sign-in failed:", signError);
            toast({
              title: "Account Created!",
              description:
                "Your account has been created. Please log in to continue.",
            });
            clearSignupState();
            setTimeout(() => {
              window.location.href = "/login";
            }, 1000);
            return;
          }
        }

        setIsVerifying(true);
        clearSignupState();
        toast({
          title: "Welcome to Asocialmedia!",
          description:
            "Your account has been created successfully. Please log in.",
        });
        verificationChannel.current?.postMessage("verification-success");
        setTimeout(() => {
          window.location.href = "/login";
        }, 1000);
      } catch (verificationError) {
        const message =
          verificationError instanceof Error
            ? verificationError.message
            : "OTP verification failed";
        toast({
          variant: "destructive",
          title: "Verification Failed",
          description: message,
        });
        throw verificationError;
      } finally {
        setVerifying(false);
      }
    },
    [clearSignupState, currentEmail, form, setIsVerifying, setVerifying, toast]
  );

  const handleBackToCodeEntry = useCallback(() => {
    setOTPState(currentEmail || form.getValues("email"));
  }, [currentEmail, form, setOTPState]);

  const handleResendVerificationLink = useCallback(async () => {
    if (!canResend()) {
      return;
    }
    setResending(true);
    const { sendVerificationLink } = await import(
      "@/app/(auth)/signup/actions"
    );
    const res = await sendVerificationLink(
      currentEmail || form.getValues("email")
    );
    if (res.success) {
      resetResendCountdown();
      startResendCountdown();
      setRateLimit("resend", { isLimited: false });
      toast({
        title: "Email Sent!",
        description: "A new verification link has been sent to your email.",
      });
    } else if (res.rateLimited && res.rateLimitInfo) {
      setRateLimit("resend", {
        remaining: res.rateLimitInfo.remaining,
        resetTime: res.rateLimitInfo.resetTime,
        isLimited: true,
      });
      toast({
        variant: "destructive",
        title: "Rate Limited!",
        description: res.error || "Too many requests. Try again later.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Failed to Send",
        description: res.error || "Failed to send verification link.",
      });
    }
    setResending(false);
  }, [
    canResend,
    currentEmail,
    form,
    resetResendCountdown,
    setRateLimit,
    setResending,
    startResendCountdown,
    toast,
  ]);

  const handleResendOtpButton = useCallback(async () => {
    if (!canResend()) {
      return;
    }
    setTooltipDismissed(true);
    setResending(true);
    const { resendVerificationEmail } = await import(
      "@/app/(auth)/signup/actions"
    );
    const result = await resendVerificationEmail(
      currentEmail || form.getValues("email")
    );
    if (result.success) {
      resetCountdown();
      startCountdown();
      setOtp("");
      setTooltipDismissed(false);
      setRateLimit("resend", { isLimited: false });
      toast({
        title: "Code Sent!",
        description: "A new verification code has been sent.",
      });
    } else if (result.rateLimited && result.rateLimitInfo) {
      setRateLimit("resend", {
        remaining: result.rateLimitInfo.remaining,
        resetTime: result.rateLimitInfo.resetTime,
        isLimited: true,
      });
      toast({
        variant: "destructive",
        title: "Rate Limited!",
        description: result.error || "Too many requests. Try again later.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Failed to Resend",
        description: result.error || "Failed to resend verification code.",
      });
    }
    setResending(false);
  }, [
    canResend,
    currentEmail,
    form,
    resetCountdown,
    setRateLimit,
    setResending,
    startCountdown,
    toast,
  ]);

  const handleOtpChange = useCallback(
    (val: string) => {
      if (DIGITS_ONLY_REGEX.test(val)) {
        setOtp(val);
        setOtpError(false);
        if (val.length === 6) {
          handleOTPVerification(val);
        }
      } else {
        setOtpError(true);
        toast({
          variant: "destructive",
          title: "Numbers only, please!",
          description: "We're looking for digits, not your life story!",
          duration: 2000,
        });
      }
    },
    [handleOTPVerification, toast]
  );

  const handleResendOtpCode = useCallback(async () => {
    if (!canResend()) {
      return;
    }
    setResending(true);
    const { resendVerificationEmail } = await import(
      "@/app/(auth)/signup/actions"
    );
    const result = await resendVerificationEmail(
      currentEmail || form.getValues("email")
    );
    if (result.success) {
      resetOtpResendCountdown();
      startOtpResendCountdown();
      setOtp("");
      setRateLimit("resend", { isLimited: false });
      toast({
        title: "Code Sent!",
        description: "A new verification code has been sent.",
      });
    } else if (result.rateLimited && result.rateLimitInfo) {
      setRateLimit("resend", {
        remaining: result.rateLimitInfo.remaining,
        resetTime: result.rateLimitInfo.resetTime,
        isLimited: true,
      });
      toast({
        variant: "destructive",
        title: "Rate Limited!",
        description: result.error || "Too many requests. Try again later.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Failed to Resend",
        description: result.error || "Failed to resend verification code.",
      });
    }
    setResending(false);
  }, [
    canResend,
    currentEmail,
    form,
    resetOtpResendCountdown,
    setRateLimit,
    setResending,
    startOtpResendCountdown,
    toast,
  ]);

  const handleVerifyViaEmailLink = useCallback(async () => {
    const { sendVerificationLink } = await import(
      "@/app/(auth)/signup/actions"
    );
    const res = await sendVerificationLink(
      currentEmail || form.getValues("email")
    );
    if (res.success) {
      setEmailVerificationState(currentEmail || form.getValues("email"));
      setRateLimit("resend", { isLimited: false });
      toast({
        title: "Email Link Sent!",
        description: "Check your inbox for the verification link.",
      });
    } else if (res.rateLimited && res.rateLimitInfo) {
      setRateLimit("resend", {
        remaining: res.rateLimitInfo.remaining,
        resetTime: res.rateLimitInfo.resetTime,
        isLimited: true,
      });
      toast({
        variant: "destructive",
        title: "Rate Limited!",
        description: res.error || "Too many requests. Try again later.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Failed to Send",
        description: res.error || "Failed to send verification link.",
      });
    }
  }, [currentEmail, form, setEmailVerificationState, setRateLimit, toast]);

  return (
    <div>
      <div className="relative">
        <AnimatePresence initial={false} mode="wait">
          {!showOTPPanel && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              initial={{ opacity: 0, y: 8 }}
              key="signup-form"
              transition={{ duration: 0.25 }}
            >
              <Form {...form}>
                <form
                  autoComplete="on"
                  className="space-y-3"
                  noValidate
                  onSubmit={form.handleSubmit(onSubmit, handleInvalidSubmit)}
                >
                  {error ? (
                    <div className="premium-error p-3 text-center text-sm">
                      <p className="flex items-center justify-center gap-2">
                        <AlertCircle className="h-5 w-5 shrink-0 text-[#ff7b63]" />
                        {error}
                      </p>
                    </div>
                  ) : null}
                  <FormField
                    control={form.control}
                    name="username"
                    render={renderUsernameField}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={renderEmailField}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={renderPasswordField}
                  />

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center space-x-2.5">
                      <Checkbox
                        checked={isAgeVerified}
                        className="transition-all duration-500 ease-in-out"
                        id={ageVerifyId}
                        onCheckedChange={handleAgeVerifyChange}
                      />
                      <label
                        className="text-muted-foreground text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        htmlFor={ageVerifyId}
                      >
                        Yes, I've survived enough birthdays to be here
                      </label>
                    </div>

                    <div className="flex items-start space-x-2.5">
                      <Checkbox
                        checked={acceptedTerms}
                        className="mt-0.5 transition-all duration-500 ease-in-out"
                        id={termsId}
                        onCheckedChange={handleTermsChange}
                      />
                      <label
                        className="text-muted-foreground text-sm leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        htmlFor={termsId}
                      >
                        I agree to the{" "}
                        <Link
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          href="/toc"
                        >
                          Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          href="/privacy"
                        >
                          Privacy Policy
                        </Link>
                      </label>
                    </div>

                    <LoadingButton
                      className="my-4 w-full"
                      loading={isPending || isLoading || isStarting}
                      type="submit"
                      variant="premium"
                    >
                      Create account
                    </LoadingButton>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="mt-2 w-full border-border/30 border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="mt-2 px-2 text-muted-foreground">
                        or continue with
                      </span>
                    </div>
                  </div>
                </form>
              </Form>
            </motion.div>
          )}

          {showOTPPanel ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="relative space-y-6"
              exit={{ opacity: 0, y: -8 }}
              initial={{ opacity: 0, y: 8 }}
              key="otp-panel"
              transition={{ duration: 0.25 }}
            >
              {showEmailVerification ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 p-6"
                  exit={{ opacity: 0, y: 20 }}
                  initial={{ opacity: 0, y: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  <button
                    className="group -mt-2 mb-2 -ml-2 flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
                    onClick={handleBackToCodeEntry}
                    type="button"
                  >
                    <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                    <span>Back to Code Entry</span>
                  </button>
                  <div className="flex flex-col items-center space-y-2 pt-2 text-center">
                    <div className="relative">
                      <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-md" />
                      <div className="relative rounded-full border border-primary/20 bg-background/80 p-4 backdrop-blur-sm">
                        <Mail className="h-8 w-8 text-primary" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3 className="bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text font-bold text-2xl text-transparent">
                        Check Your Email
                      </h3>
                    </div>

                    <div className="space-y-3">
                      <p className="text-muted-foreground text-sm">
                        We've sent a verification link to
                      </p>
                      <p className="rounded-lg border border-border/50 bg-muted/50 px-4 py-2 font-medium text-foreground">
                        {currentEmail || form.getValues("email")}
                      </p>
                    </div>

                    <div className="w-full space-y-3 pt-2">
                      <Button
                        className="w-full cursor-pointer"
                        disabled={isResending || !canResend()}
                        onClick={handleResendVerificationLink}
                        type="button"
                        variant="premium"
                      >
                        {(() => {
                          if (isResending) {
                            return "Sending...";
                          }
                          if (resendCountdownInfo.isActive) {
                            return `Resend available in ${resendCountdownInfo.timeLeft}s`;
                          }
                          return "Resend verification email";
                        })()}
                      </Button>

                      <details className="group">
                        <summary className="flex cursor-pointer items-center justify-center gap-1 text-center text-muted-foreground text-xs transition-colors hover:text-foreground">
                          <span>More info</span>
                          <svg
                            className="h-3 w-3 transition-transform group-open:rotate-180"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <title>Toggle more info</title>
                            <path
                              d="M19 9l-7 7-7-7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </summary>
                        <p className="mt-2 text-center text-muted-foreground text-xs">
                          Please check your inbox to complete your registration
                          or Check your spam folder if you don't see the email
                          in your inbox
                        </p>
                      </details>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                  exit={{ opacity: 0, y: -20 }}
                  initial={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="space-y-6 p-4 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1 text-left">
                        <h2 className="font-bold text-foreground text-lg sm:text-2xl">
                          Verify Your Email
                        </h2>
                        <p className="text-muted-foreground text-xs sm:text-sm">
                          Enter the 6-digit code sent to
                        </p>
                        <p className="truncate font-medium text-foreground text-xs sm:text-sm">
                          {currentEmail || form.getValues("email")}
                        </p>
                      </div>

                      <div className="relative shrink-0">
                        <motion.button
                          animate={
                            count === 0 && !tooltipDismissed
                              ? {
                                  y: [0, -8, 0],
                                  transition: {
                                    duration: 0.6,
                                    repeat: Number.POSITIVE_INFINITY,
                                    ease: "easeInOut",
                                  },
                                }
                              : {}
                          }
                          className="group relative h-12 w-12 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 sm:h-16 sm:w-16"
                          disabled={!canResend() || count > 0}
                          onClick={handleResendOtpButton}
                          type="button"
                        >
                          <svg
                            className="h-full w-full -rotate-90 transform"
                            viewBox="0 0 100 100"
                          >
                            <title>Resend verification code timer</title>
                            <circle
                              className="stroke-muted"
                              cx="50"
                              cy="50"
                              fill="none"
                              r="45"
                              strokeWidth="8"
                            />
                            <motion.circle
                              animate={{
                                strokeDashoffset: 283 - (count / 300) * 283,
                              }}
                              className={`transition-colors ${count < 60 ? "stroke-destructive" : "stroke-primary"}`}
                              cx="50"
                              cy="50"
                              fill="none"
                              r="45"
                              strokeDasharray="283"
                              strokeDashoffset="283"
                              strokeLinecap="round"
                              strokeWidth="8"
                              transition={{ duration: 1, ease: "linear" }}
                            />
                          </svg>
                          {count === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xl sm:text-2xl">↻</span>
                            </div>
                          )}
                        </motion.button>

                        <AnimatePresence>
                          {count === 0 && !tooltipDismissed && (
                            <motion.div
                              animate={{ opacity: 1, scale: 1 }}
                              className="absolute top-full right-0 z-10 mt-2 w-40 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg sm:w-48 sm:p-3"
                              exit={{ opacity: 0, scale: 0.95 }}
                              initial={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
                            >
                              <p className="text-[10px] sm:text-xs">
                                Code expired! Click the button to resend a new
                                verification code.
                              </p>
                              <div className="absolute -top-2 right-4 h-4 w-4 rotate-45 border-border border-t border-l bg-popover" />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <motion.div
                        animate={otpError ? { x: [-10, 10, -10, 10, 0] } : {}}
                        className="flex justify-center"
                        transition={{ duration: 0.4 }}
                      >
                        <InputOTP
                          containerClassName="w-full"
                          disabled={isVerifyingOTP || count === 0}
                          maxLength={6}
                          onChange={handleOtpChange}
                          pattern="[0-9]*"
                          value={otp}
                        >
                          <InputOTPGroup className="w-full justify-between">
                            {OTP_SLOT_IDS.map((slotId, index) => (
                              <motion.div
                                animate={
                                  otp[index]
                                    ? {
                                        scale: [1, 1.1, 1],
                                        rotate: [0, 5, -5, 0],
                                      }
                                    : {}
                                }
                                className="flex-1"
                                key={slotId}
                                transition={{ duration: 0.3 }}
                              >
                                <InputOTPSlot
                                  className={`w-full ${otpError ? "border-destructive" : ""}`}
                                  index={index}
                                />
                              </motion.div>
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </motion.div>

                      <AnimatePresence mode="wait">
                        {isVerifyingOTP ? (
                          <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center justify-center gap-2 text-primary text-sm"
                            exit={{ opacity: 0, y: -10 }}
                            initial={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                          >
                            <motion.div
                              animate={{ rotate: 360 }}
                              className="h-4 w-4 shrink-0 rounded-full border-2 border-primary/20 border-t-primary"
                              transition={{
                                duration: 1,
                                repeat: Number.POSITIVE_INFINITY,
                                ease: "linear",
                              }}
                            />
                            <span>Verifying your code...</span>
                          </motion.div>
                        ) : null}
                        {!isVerifyingOTP && otpError && (
                          <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center justify-center gap-2 text-destructive text-sm"
                            exit={{ opacity: 0, y: -10 }}
                            initial={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                          >
                            <AlertCircle className="h-5 w-5 shrink-0" />
                            <span>
                              That code didn't work. Please try again.
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="space-y-2">
                      <AnimatePresence>
                        {otpResendCount === 0 ? (
                          <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            initial={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                          >
                            <Button
                              className="w-full cursor-pointer"
                              disabled={isResending || !canResend()}
                              onClick={handleResendOtpCode}
                              type="button"
                              variant="premium"
                            >
                              {isResending ? "Sending..." : "Resend Code"}
                            </Button>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>

                      <Button
                        className="btn-3d-gray w-full cursor-pointer"
                        onClick={handleVerifyViaEmailLink}
                        type="button"
                        variant="ghost"
                      >
                        Verify via Email Link Instead
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function scrollToError(fieldName: string) {
  requestAnimationFrame(() => {
    const element = document.querySelector(`[name="${fieldName}"]`);
    element?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}
