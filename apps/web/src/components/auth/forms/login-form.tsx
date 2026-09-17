"use client";

import { loginSchema } from "@asm/auth/validation";
import type { LoginValues } from "@asm/auth/validation";
import { clientLog } from "@asm/config/debug";
import { Checkbox } from "@asm/ui/shadui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
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
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  KeyRound,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";

import { login } from "@/app/(auth)/login/actions";
import type { TwoFactorLoginMethod } from "@/app/(auth)/login/actions";
import { resendVerificationEmail } from "@/app/(auth)/signup/actions";
import { LoadingButton } from "@/components/auth/fields/loading-button";
import { PasswordInput } from "@/components/auth/fields/password-input";
import ForgotPasswordLink from "@/components/auth/shell/forgot-password-link";
import { authClient } from "@/lib/auth/auth";
import { useToast } from "@/lib/gooey-toast";

interface LoginFormProps {
  actionAccessory?: ReactNode;
  lastLoginMethod?: string | null;
}

type VerificationMethod = "backup" | "email" | "totp";

const OTP_SLOT_IDS = [
  "slot-0",
  "slot-1",
  "slot-2",
  "slot-3",
  "slot-4",
  "slot-5",
];

const verificationMethodCopy: Record<VerificationMethod, string> = {
  backup:
    "Enter one of the recovery codes you saved when setting up your authenticator.",
  email: "We’ll send a six-digit code to your verified email address.",
  totp: "Enter the six-digit code from your authenticator app.",
};

export function getAvailableVerificationMethods(
  methods: readonly TwoFactorLoginMethod[]
): readonly VerificationMethod[] {
  const availableMethods: VerificationMethod[] = [];
  if (methods.includes("totp")) {
    availableMethods.push("totp", "backup");
  }
  if (methods.includes("otp")) {
    availableMethods.push("email");
  }
  return availableMethods;
}

export function getResendCountdown(
  resendAvailableAt: number,
  currentTime: number
): number {
  return Math.max(0, Math.ceil((resendAvailableAt - currentTime) / 1000));
}

function getEmailCodeStatus(sent: boolean, resendCountdown: number): string {
  if (!sent) {
    return "Send a security code to your verified email when you’re ready.";
  }
  if (resendCountdown > 0) {
    return `Code sent. You can request another in ${resendCountdown}s.`;
  }
  return "Didn’t receive the code? Request another one.";
}

function InlineTwoFactorForm({
  methods,
  onBack,
}: {
  methods: readonly TwoFactorLoginMethod[];
  onBack: () => void;
}) {
  const { toast } = useToast();
  const availableMethods = getAvailableVerificationMethods(methods);
  const [method, setMethod] = useState<VerificationMethod>(
    availableMethods[0] ?? "email"
  );
  const [code, setCode] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [emailDeliveryError, setEmailDeliveryError] = useState<string>();
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const trustDeviceId = useId();
  const resendCountdown = getResendCountdown(resendAvailableAt, currentTime);

  const methodLabels: Record<VerificationMethod, string> = {
    backup: "Recovery code",
    email: "Email code",
    totp: "Authenticator",
  };
  const methodIcons: Record<
    VerificationMethod,
    typeof Mail | typeof KeyRound | typeof ShieldCheck
  > = {
    backup: ShieldCheck,
    email: Mail,
    totp: KeyRound,
  };

  const sendEmailCode = useCallback(async () => {
    setIsPending(true);
    setEmailDeliveryError(undefined);
    try {
      const result = await authClient.twoFactor.sendOtp({ trustDevice });
      if (result.error) {
        setEmailDeliveryError(
          result.error.message || "We couldn’t send a security code. Try again."
        );
      } else {
        setSent(true);
        setCurrentTime(Date.now());
        setResendAvailableAt(Date.now() + 30_000);
        toast({
          description: "Check your inbox for your six-digit security code.",
          title: "Security code sent",
        });
      }
    } catch (sendError) {
      clientLog.error("Two-factor email send error:", sendError);
      setEmailDeliveryError("We couldn’t send a security code. Try again.");
    }
    setIsPending(false);
  }, [toast, trustDevice]);

  useEffect(() => {
    if (resendCountdown === 0) {
      return;
    }

    const timer = window.setTimeout(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCountdown]);

  async function verifyCodeValue(normalizedCode: string) {
    if (!normalizedCode) {
      return;
    }

    setIsPending(true);
    try {
      let result;
      if (method === "email") {
        result = await authClient.twoFactor.verifyOtp({
          code: normalizedCode,
          trustDevice,
        });
      } else if (method === "totp") {
        result = await authClient.twoFactor.verifyTotp({
          code: normalizedCode,
          trustDevice,
        });
      } else {
        result = await authClient.twoFactor.verifyBackupCode({
          code: normalizedCode,
          trustDevice,
        });
      }

      if (result.error) {
        toast({
          description:
            result.error.message ||
            "That code could not be verified. Try again.",
          title: "Couldn’t verify code",
          variant: "destructive",
        });
      } else {
        window.location.assign("/");
      }
    } catch (verificationError) {
      clientLog.error("Two-factor verification error:", verificationError);
      toast({
        description: "We couldn’t verify that code. Try again.",
        title: "Couldn’t verify code",
        variant: "destructive",
      });
    }
    setIsPending(false);
  }

  function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verifyCodeValue(code.trim());
  }

  function handleOtpChange(value: string) {
    setCode(value);
    if (value.length === 6 && !isPending) {
      void verifyCodeValue(value);
    }
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <div className="flex items-start gap-3">
        <div className="icon-btn-3d bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
          <ShieldCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">One more step</p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Verify it’s you to finish signing in.
          </p>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center gap-1 rounded-lg px-1 text-xs transition-colors"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {(() => {
            const MethodIcon = methodIcons[method];
            return <MethodIcon className="text-primary size-4 shrink-0" />;
          })()}
          <span>{methodLabels[method]}</span>
        </div>
        {availableMethods.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="text-muted-foreground hover:text-foreground inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors"
                type="button"
              >
                More options
                <ChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 rounded-xl">
              {availableMethods.map((availableMethod) => {
                const MethodIcon = methodIcons[availableMethod];
                return (
                  <DropdownMenuItem
                    className="gap-2"
                    disabled={availableMethod === method}
                    key={availableMethod}
                    onSelect={() => {
                      setCode("");
                      setMethod(availableMethod);
                    }}
                  >
                    <MethodIcon className="size-4" />
                    {methodLabels[availableMethod]}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <form className="space-y-3" onSubmit={verifyCode}>
        <p className="text-muted-foreground text-sm">
          {verificationMethodCopy[method]}
        </p>

        {method === "email" ? (
          <div className="space-y-2">
            {emailDeliveryError ? (
              <div className="border-destructive/25 bg-destructive/8 text-destructive rounded-xl border px-3 py-2 text-sm">
                {emailDeliveryError}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {getEmailCodeStatus(sent, resendCountdown)}
              </p>
            )}

            {(!sent || emailDeliveryError || resendCountdown === 0) && (
              <button
                className="btn-3d-gray flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={sendEmailCode}
                type="button"
              >
                <Mail className="size-4" />
                {emailDeliveryError
                  ? "Try sending the code again"
                  : "Send another code"}
              </button>
            )}
          </div>
        ) : null}

        {method === "backup" ? (
          <Input
            autoComplete="one-time-code"
            maxLength={64}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Recovery code"
            required
            value={code}
          />
        ) : (
          <div className="flex justify-center">
            <InputOTP
              containerClassName="w-full"
              disabled={isPending || (method === "email" && !sent)}
              maxLength={6}
              onChange={handleOtpChange}
              pattern="[0-9]*"
              value={code}
            >
              <InputOTPGroup className="w-full justify-between">
                {OTP_SLOT_IDS.map((slotId, index) => (
                  <InputOTPSlot className="w-full" index={index} key={slotId} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <Checkbox
            checked={trustDevice}
            id={trustDeviceId}
            onCheckedChange={(checked) => setTrustDevice(checked === true)}
          />
          <label
            className="text-muted-foreground cursor-pointer text-sm"
            htmlFor={trustDeviceId}
          >
            Trust this device for 30 days
          </label>
        </div>

        <LoadingButton
          className="w-full"
          disabled={method === "email" && !sent}
          loading={isPending}
          type="submit"
          variant="premium"
        >
          Verify and sign in
        </LoadingButton>
      </form>
    </motion.div>
  );
}

export default function LoginForm({
  actionAccessory,
  lastLoginMethod,
}: LoginFormProps) {
  const { toast } = useToast();
  const [error, setError] = useState<string>();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>();
  const [isVerificationEmailSent, setIsVerificationEmailSent] = useState(false);
  const [twoFactorMethods, setTwoFactorMethods] = useState<
    readonly TwoFactorLoginMethod[] | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const [shake, setShake] = useState(false);
  const [errorFields, setErrorFields] = useState<{
    username?: boolean;
    password?: boolean;
  }>({});

  const form = useForm<LoginValues>({
    defaultValues: {
      password: "",
      username: "",
    },
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (shake) {
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [shake]);

  useEffect(() => {
    // oxlint-disable-next-line react/incompatible-library -- react-hook-form watch handle is unmemoizable by design; compiler skips this component
    const subscription = form.watch(() => {
      if (Object.keys(errorFields).length > 0) {
        setErrorFields({});
      }
    });
    return () => subscription.unsubscribe();
  }, [form, errorFields]);

  function onSubmit(values: LoginValues) {
    setError(undefined);
    setUnverifiedEmail(undefined);
    setIsVerificationEmailSent(false);
    setErrorFields({});
    startTransition(() => handleLogin(values));
  }

  async function handleLogin(values: LoginValues) {
    try {
      const result = await login(values);

      if (result.error) {
        handleLoginError(result.error);
      } else if (result.requiresTwoFactor) {
        setTwoFactorMethods(result.twoFactorMethods);
      } else if (result.success) {
        handleLoginSuccess(values.username);
      }
    } catch (loginError) {
      clientLog.error("Login error:", loginError);
      toast({
        description: "Something went wrong, try again? Our bad!",
        duration: 5000,
        title: "Login Failed",
        variant: "destructive",
      });
    }
  }

  function handleLoginError(loginErrorMessage: string) {
    setError(loginErrorMessage);
    setShake(true);
    if (loginErrorMessage.includes("Invalid username/email or password")) {
      setErrorFields({ password: true, username: true });
    }
    toast({
      description: loginErrorMessage,
      duration: 5000,
      title: "Login Failed",
      variant: "destructive",
    });
  }

  function handleLoginSuccess(username: string) {
    const displayName = username.includes("@")
      ? username.split("@")[0]
      : username;

    toast({
      description: "You're in! Let's get this bread!",
      duration: 3000,
      title: `Welcome back, ${displayName}!`,
    });

    // A hard navigation reads the session cookie that the sign-in response
    // just set, rather than reusing the guest App Router layout cache.
    window.location.assign("/");
  }

  const renderUsernameField = useCallback(
    ({ field }: { field: ControllerRenderProps<LoginValues, "username"> }) => (
      <FormItem>
        <FormLabel>Username or Email</FormLabel>
        <FormControl>
          <div className="relative">
            <Input
              placeholder="cooluser or email@cool.user"
              {...field}
              autoComplete="username"
              className={`transition-all duration-500 ease-in-out ${
                errorFields.username
                  ? "border-destructive/50 bg-destructive/10"
                  : ""
              }`}
              name="username"
            />
            {errorFields.username ? (
              <motion.div
                animate={{ opacity: 1 }}
                className="absolute top-1/2 right-3 -translate-y-1/2"
                initial={{ opacity: 0 }}
              >
                <XCircle className="text-destructive h-4 w-4" />
              </motion.div>
            ) : null}
          </div>
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    [errorFields]
  );

  const renderPasswordField = useCallback(
    ({ field }: { field: ControllerRenderProps<LoginValues, "password"> }) => (
      <FormItem>
        <FormLabel>Password</FormLabel>
        <FormControl>
          <div className="relative">
            <PasswordInput
              placeholder="supersecret"
              {...field}
              autoComplete="current-password"
              className={`transition-all duration-500 ease-in-out ${
                errorFields.password
                  ? "border-destructive/50 bg-destructive/10"
                  : ""
              }`}
              name="password"
            />
          </div>
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    [errorFields]
  );

  const handleResendVerification = async () => {
    if (!unverifiedEmail) {
      return;
    }

    try {
      const result = await resendVerificationEmail(unverifiedEmail);
      if (result.error) {
        toast({
          description: result.error,
          duration: 5000,
          title: "Verification Failed!",
          variant: "destructive",
        });
      } else if (result.success) {
        toast({
          description:
            "Check your inbox (and spam folder, just in case) to verify your email!",
          duration: 5000,
          title: "Verification Email Sent!",
        });
      }
    } catch (resendError) {
      clientLog.error("Resend verification error:", resendError);
      toast({
        description: "Something went wrong, try again? Our bad!",
        duration: 5000,
        title: "Verification Failed!",
        variant: "destructive",
      });
    }
  };

  if (twoFactorMethods) {
    return (
      <InlineTwoFactorForm
        methods={twoFactorMethods}
        onBack={() => setTwoFactorMethods(null)}
      />
    );
  }

  return (
    <Form {...form}>
      <motion.div
        animate={shake ? "shake" : "stable"}
        variants={{
          shake: {
            transition: { duration: 0.5 },
            x: [0, -10, 10, -10, 10, 0],
          },
          stable: { x: 0 },
        }}
      >
        <form
          autoComplete="on"
          className="space-y-3"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <AnimatePresence mode="wait">
            {error ? (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="premium-error p-3 text-center text-sm"
                exit={{ opacity: 0, y: -20 }}
                initial={{ opacity: 0, y: -20 }}
              >
                <p className="flex items-center justify-center gap-2">
                  <AlertCircle className="h-4 w-4 text-[#ff7b63]" />
                  {error}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {unverifiedEmail ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="border-primary/20 bg-primary/5 rounded-lg border p-6 text-sm"
              initial={{ opacity: 0, y: -20 }}
            >
              <div className="flex flex-col items-center space-y-4">
                <div className="relative">
                  <div className="bg-primary/20 absolute inset-0 animate-pulse rounded-full blur-md" />
                  <div className="border-primary/20 bg-background/80 relative rounded-full border p-3 backdrop-blur-sm">
                    <Mail className="text-primary h-6 w-6" />
                  </div>
                </div>

                <div className="space-y-2 text-center">
                  <p className="text-foreground font-medium">
                    Email Verification Required
                  </p>
                  <p className="text-muted-foreground">
                    {isVerificationEmailSent
                      ? `We've sent a verification email to ${unverifiedEmail}`
                      : "Your email address needs to be verified to continue."}
                  </p>
                </div>

                <button
                  className="group relative w-full"
                  onClick={handleResendVerification}
                  type="button"
                >
                  <div className="bg-primary absolute -inset-0.5 rounded-lg opacity-10 blur-sm transition group-hover:opacity-20" />
                  <div className="border-primary/20 bg-background/80 text-primary hover:bg-background/90 relative flex items-center justify-center gap-2 rounded-lg border px-4 py-2 transition-colors">
                    <Mail className="h-4 w-4" />
                    <span>
                      {isVerificationEmailSent
                        ? "Resend verification email"
                        : "Send verification email"}
                    </span>
                  </div>
                </button>
              </div>
            </motion.div>
          ) : null}

          <FormField
            control={form.control}
            name="username"
            render={renderUsernameField}
          />
          {lastLoginMethod === "email" ? (
            <p className="text-muted-foreground -mt-2 ml-0.5 text-[10px] leading-none">
              Last used recently
            </p>
          ) : null}

          <FormField
            control={form.control}
            name="password"
            render={renderPasswordField}
          />

          <div className="flex items-center justify-end space-x-0">
            <ForgotPasswordLink />
            <span className="text-muted-foreground text-sm">or</span>
            <Link
              className="text-muted-foreground hover:text-primary px-2 py-1 text-sm transition-colors duration-300"
              href="/support"
            >
              Need help?
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <LoadingButton
              className="flex-1"
              loading={isPending}
              type="submit"
              variant="premium"
            >
              Log in
            </LoadingButton>
            {actionAccessory}
          </div>
        </form>
      </motion.div>
    </Form>
  );
}
