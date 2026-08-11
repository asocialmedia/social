"use client";

import { type LoginValues, loginSchema } from "@asm/auth/validation";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import supportImage from "@assets/previews/help.png";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Mail, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { type ControllerRenderProps, useForm } from "react-hook-form";
import { login } from "@/app/(auth)/login/actions";
import { resendVerificationEmail } from "@/app/(auth)/signup/actions";
import ForgotPasswordLink from "@/components/auth/forgot-password-link";
import { LoadingButton } from "@/components/auth/loading-button";
import { PasswordInput } from "@/components/auth/password-input";
import { useToast } from "@/lib/gooey-toast";
import { HelpLink } from "../animations/image-link-preview";

export default function LoginForm() {
  const { toast } = useToast();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>();
  const [isVerificationEmailSent, setIsVerificationEmailSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [shake, setShake] = useState(false);
  const [errorFields, setErrorFields] = useState<{
    username?: boolean;
    password?: boolean;
  }>({});

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  useEffect(() => {
    if (shake) {
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [shake]);

  useEffect(() => {
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
      } else if (result.success) {
        handleLoginSuccess(values.username);
      }
    } catch (loginError) {
      console.error("Login error:", loginError);
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: "Something went wrong, try again? Our bad!",
        duration: 5000,
      });
    }
  }

  function handleLoginError(loginErrorMessage: string) {
    setError(loginErrorMessage);
    setShake(true);
    if (loginErrorMessage.includes("Invalid username/email or password")) {
      setErrorFields({ username: true, password: true });
    }
    toast({
      variant: "destructive",
      title: "Login Failed",
      description: loginErrorMessage,
      duration: 5000,
    });
  }

  function handleLoginSuccess(username: string) {
    const displayName = username.includes("@")
      ? username.split("@")[0]
      : username;

    toast({
      title: `Welcome back, ${displayName}!`,
      description: "You're in! Let's get this bread!",
      duration: 3000,
    });

    router.refresh();
    router.push("/");
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
                <XCircle className="h-4 w-4 text-destructive" />
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
          variant: "destructive",
          title: "Verification Failed!",
          description: result.error,
          duration: 5000,
        });
      } else if (result.success) {
        toast({
          title: "Verification Email Sent!",
          description:
            "Check your inbox (and spam folder, just in case) to verify your email!",
          duration: 5000,
        });
      }
    } catch (resendError) {
      console.error("Resend verification error:", resendError);
      toast({
        variant: "destructive",
        title: "Verification Failed!",
        description: "Something went wrong, try again? Our bad!",
        duration: 5000,
      });
    }
  };

  return (
    <Form {...form}>
      <motion.div
        animate={shake ? "shake" : "stable"}
        variants={{
          shake: {
            x: [0, -10, 10, -10, 10, 0],
            transition: { duration: 0.5 },
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
              className="rounded-lg border border-primary/20 bg-primary/5 p-6 text-sm"
              initial={{ opacity: 0, y: -20 }}
            >
              <div className="flex flex-col items-center space-y-4">
                <div className="relative">
                  <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-md" />
                  <div className="relative rounded-full border border-primary/20 bg-background/80 p-3 backdrop-blur-sm">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                </div>

                <div className="space-y-2 text-center">
                  <p className="font-medium text-foreground">
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
                  <div className="absolute -inset-0.5 rounded-lg bg-primary opacity-10 blur-sm transition group-hover:opacity-20" />
                  <div className="relative flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-background/80 px-4 py-2 text-primary transition-colors hover:bg-background/90">
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

          <FormField
            control={form.control}
            name="password"
            render={renderPasswordField}
          />

          <div className="flex items-center justify-end space-x-0">
            <ForgotPasswordLink />
            <span className="text-muted-foreground text-sm">or</span>
            <HelpLink
              href="/support"
              previewImage={supportImage.src}
              text="Need help?"
            />
          </div>

          <LoadingButton
            className="w-full"
            loading={isPending}
            type="submit"
            variant="premium"
          >
            Log in
          </LoadingButton>
        </form>
      </motion.div>
    </Form>
  );
}
