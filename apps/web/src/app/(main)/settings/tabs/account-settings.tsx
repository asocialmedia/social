"use client";

import type { PrivateUserData } from "@asm/db";
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
import type { LucideIcon } from "lucide-react";
import { AtSign, KeyRound, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";
import { z } from "zod";

import { LoadingButton } from "@/components/auth/loading-button";
import AddEmailBanner from "@/components/settings/add-email-banner";
import LinkAccountAlert from "@/components/settings/link-account-alert";
import LinkedAccounts from "@/components/settings/linked-accounts";
import type { AccountLinkingReadiness } from "@/components/settings/linked-accounts";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

import {
  useSendCurrentEmailCode,
  useUpdateEmail,
  useUpdateUsername,
  useVerifyEmailChange,
} from "../mutations";

const usernameSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores"
    ),
});

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  // Code sent to the current email; required to change it (Reddit accounts
  // without an email skip this).
  otp: z.string().optional(),
});

const emailVerifySchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  otp: z.string().min(4, "Please enter the verification code"),
});

const passwordSetupSchema = z
  .object({
    confirmPassword: z.string(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(256, "Password must be at most 256 characters"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type UsernameFormValues = z.infer<typeof usernameSchema>;
type EmailFormValues = z.infer<typeof emailSchema>;
type EmailVerifyFormValues = z.infer<typeof emailVerifySchema>;
type PasswordSetupFormValues = z.infer<typeof passwordSetupSchema>;

// The email change runs as one staged flow inside the card:
//   idle    -> type the new address, press Update Email
//   current -> confirm the code sent to the CURRENT address (skipped when the
//              account has none, e.g. Reddit-only sign-ups)
//   new     -> confirm the code sent to the NEW address
type EmailStep = "idle" | "current" | "new";

function handleSocialLink(provider: string) {
  // Navigate to the link route which starts the OAuth flow with the user's
  // session and redirects back to the provider's authorization page.
  window.location.href = `/api/auth/link/${provider}?confirmed=1`;
}

// React Compiler cannot lower `throw` statements inside component try blocks,
// so the password request and its status check live in this module-scoped
// helper.
async function requestSetPassword(password: string): Promise<void> {
  const response = await fetch("/api/users/password", {
    body: JSON.stringify({ password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Couldn't add a password. Please try again.");
  }
}

const BUTTON_CLASS = cn(
  "h-9 rounded-xl px-5",
  ORANGE_GRADIENT_CLASS,
  "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
);

// Card sub-heading: a titled block shared by every account section so the
// merged card reads as one surface with clear parts.
const CardHeading = ({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) => (
  <div className="flex items-center gap-2">
    <div
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-lg",
        ORANGE_GRADIENT_CLASS
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </div>
    <div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  </div>
);

const UsernameFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<UsernameFormValues, "username">;
}) => (
  <FormItem>
    <FormLabel>Username</FormLabel>
    <FormControl>
      <div className="relative">
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-medium">
          @
        </span>
        <Input
          className="premium-input h-10 rounded-xl pl-7 text-sm"
          {...field}
        />
      </div>
    </FormControl>
    <FormMessage />
  </FormItem>
);

const EmailFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<EmailFormValues, "email">;
}) => (
  <FormItem>
    <FormLabel>Email</FormLabel>
    <FormControl>
      <Input
        className="premium-input h-10 rounded-xl text-sm"
        disabled={field.disabled}
        type="email"
        {...field}
      />
    </FormControl>
    <FormMessage />
  </FormItem>
);

// Segmented 6-digit OTP input, matching the signup verification flow. Rendered
// with react-hook-form's field for wiring into FormField.
const OtpFieldRenderer = ({
  field,
}: {
  field:
    | ControllerRenderProps<EmailFormValues, "otp">
    | ControllerRenderProps<EmailVerifyFormValues, "otp">;
}) => (
  <FormItem>
    <FormLabel>Verification code</FormLabel>
    <FormControl>
      <InputOTP
        containerClassName="w-full"
        maxLength={6}
        onChange={(value) => field.onChange(value)}
        pattern="[0-9]*"
        value={field.value ?? ""}
      >
        <InputOTPGroup className="w-full justify-between">
          {Array.from({ length: 6 }).map((_, index) => (
            <InputOTPSlot
              className="w-full flex-1"
              index={index}
              key={`otp-slot-${index}`}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </FormControl>
    <FormMessage />
  </FormItem>
);

interface AccountSettingsProps {
  accountLinkingReadiness: AccountLinkingReadiness;
  user: PrivateUserData;
}

export default function AccountSettings({
  accountLinkingReadiness,
  user,
}: AccountSettingsProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [emailStep, setEmailStep] = useState<EmailStep>("idle");
  const [pendingNewEmail, setPendingNewEmail] = useState<string | null>(null);
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  const usernameForm = useForm<UsernameFormValues>({
    defaultValues: {
      username: user.username,
    },
    resolver: zodResolver(usernameSchema),
  });

  const emailForm = useForm<EmailFormValues>({
    defaultValues: {
      email: user.email || "",
      otp: "",
    },
    resolver: zodResolver(emailSchema),
  });

  const emailVerifyForm = useForm<EmailVerifyFormValues>({
    defaultValues: {
      email: user.email || "",
      otp: "",
    },
    resolver: zodResolver(emailVerifySchema),
  });

  const passwordSetupForm = useForm<PasswordSetupFormValues>({
    defaultValues: { confirmPassword: "", password: "" },
    resolver: zodResolver(passwordSetupSchema),
  });

  const usernameMutation = useUpdateUsername();
  const emailMutation = useUpdateEmail();
  const emailVerifyMutation = useVerifyEmailChange();
  const sendCurrentEmailCodeMutation = useSendCurrentEmailCode();
  const isEmailBusy =
    emailMutation.isPending ||
    emailVerifyMutation.isPending ||
    sendCurrentEmailCodeMutation.isPending;

  function onUsernameSubmit(values: UsernameFormValues) {
    if (values.username === user.username) {
      toast({
        description: "That username is already yours, pick a new one",
        title: "No Changes",
      });
      return;
    }

    usernameMutation.mutate(values, {
      onError: (error) => {
        toast({
          description:
            error.message || "That username didn't work, try another?",
          title: "Couldn't Update",
          variant: "destructive",
        });
      },
      onSuccess: (result) => {
        usernameForm.reset({ username: result.username });
        router.refresh();
        toast({
          description: result.changed
            ? "Your previous username will redirect here for the next 30 days."
            : "Your username is already up to date.",
          title: "Username Updated",
        });
      },
    });
  }

  // Stage 1 - type the new address. When the account already has an email we
  // first mail a code to the CURRENT address; accounts without one (Reddit)
  // start the change immediately and move straight to the new-email code.
  function onStartEmailChange(values: EmailFormValues) {
    if (values.email === user.email) {
      toast({
        description: "That's already your email, try a new one",
        title: "No Changes",
      });
      return;
    }

    setPendingNewEmail(values.email);
    emailVerifyForm.setValue("email", values.email);
    emailVerifyForm.setValue("otp", "");

    if (!user.email) {
      emailMutation.mutate(
        { email: values.email },
        {
          onError: () => {
            toast({
              description: "That email didn't work, try another?",
              title: "Couldn't Update",
              variant: "destructive",
            });
          },
          onSuccess: () => {
            setEmailStep("new");
            toast({
              description: `We sent a code to ${values.email} - enter it to confirm`,
              title: "Check Your Inbox",
            });
          },
        }
      );
      return;
    }

    sendCurrentEmailCodeMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          description: error.message || "Couldn't send the code, try again?",
          title: "Couldn't Send Code",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        setEmailStep("current");
        toast({
          description: `We emailed a code to ${user.email}`,
          title: "Code Sent",
        });
      },
    });
  }

  function onResendCurrentCode() {
    sendCurrentEmailCodeMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          description: error.message || "Couldn't send the code, try again?",
          title: "Couldn't Send Code",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        toast({
          description: `We emailed a new code to ${user.email}`,
          title: "Code Resent",
        });
      },
    });
  }

  // Stage 2 - confirm the code sent to the current email. This both proves the
  // owner and triggers the code to the new address.
  function onConfirmCurrentEmail(values: EmailFormValues) {
    if (!pendingNewEmail) {
      return;
    }
    emailMutation.mutate(
      { email: pendingNewEmail, otp: values.otp },
      {
        onError: (error) => {
          toast({
            description: error.message || "That code didn't work, try again?",
            title: "Couldn't Verify",
            variant: "destructive",
          });
        },
        onSuccess: () => {
          emailForm.setValue("otp", "");
          setEmailStep("new");
          toast({
            description: `We sent a code to ${pendingNewEmail} - enter it to confirm`,
            title: "Check Your Inbox",
          });
        },
      }
    );
  }

  // Stage 3 - confirm the code sent to the new email address.
  function onVerifyNewEmail(values: EmailVerifyFormValues) {
    emailVerifyMutation.mutate(values, {
      onError: (error) => {
        toast({
          description: error.message || "That code didn't work, try again?",
          title: "Couldn't Verify",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        setEmailStep("idle");
        setPendingNewEmail(null);
        emailForm.reset({ email: pendingNewEmail ?? "", otp: "" });
        emailVerifyForm.reset({ email: pendingNewEmail ?? "", otp: "" });
        router.refresh();
        toast({
          description: "Your email is updated and verified!",
          title: "Email Updated",
        });
      },
    });
  }

  function onCancelEmailChange() {
    setEmailStep("idle");
    setPendingNewEmail(null);
    emailForm.setValue("email", user.email || "");
    emailForm.setValue("otp", "");
    emailVerifyForm.setValue("otp", "");
  }

  async function onPasswordSetupSubmit(values: PasswordSetupFormValues) {
    setIsSettingPassword(true);
    try {
      await requestSetPassword(values.password);
      passwordSetupForm.reset();
      router.refresh();
      toast({
        description: "You can now connect another sign-in method.",
        title: "Password Added",
      });
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't add a password. Please try again.",
        title: "Couldn't Add Password",
        variant: "destructive",
      });
    }
    setIsSettingPassword(false);
  }

  // A short, plain-language cue for which stage of the email change is active.
  let emailStepHint: string | null = null;
  if (emailStep === "current") {
    emailStepHint = `Step 1 of 2 - confirm the code sent to ${user.email}`;
  } else if (emailStep === "new") {
    emailStepHint = `Step 2 of 2 - confirm the code sent to ${pendingNewEmail}`;
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="Your username, email and sign-in methods"
        icon={AtSign}
        title="Account"
      />

      <LinkAccountAlert />

      {/* Reddit never shares an email; accounts created through it have no
          recovery address, so prompt them to add one. */}
      {user.redditId && !user.email ? <AddEmailBanner /> : null}

      {/* One card for identity: username and email are both how people reach
          the account, so they read better as one surface with two parts. */}
      <SettingsCard>
        <div className="scroll-mt-24" id="settings-username">
          <CardHeading
            description="How people find you on asocialmedia"
            icon={AtSign}
            title="Username"
          />

          <Form {...usernameForm}>
            <form
              className="mt-4 space-y-4"
              onSubmit={usernameForm.handleSubmit(onUsernameSubmit)}
            >
              <FormField
                control={usernameForm.control}
                name="username"
                render={UsernameFieldRenderer}
              />

              <p className="text-muted-foreground -mt-1 text-xs leading-relaxed">
                Your previous username stays reserved and redirects here for 30
                days. You can make up to 5 username changes every 30 days.
              </p>

              <div className="flex justify-end">
                <LoadingButton
                  className={BUTTON_CLASS}
                  loading={usernameMutation.isPending}
                  type="submit"
                >
                  Update Username
                </LoadingButton>
              </div>
            </form>
          </Form>
        </div>

        <div className="border-border/60 my-6 border-t" />

        <div className="scroll-mt-24" id="settings-email">
          <CardHeading
            description="Where we send login and reset links"
            icon={Mail}
            title="Email Address"
          />

          {emailStepHint ? (
            <p className="text-muted-foreground mt-4 text-xs font-medium">
              {emailStepHint}
            </p>
          ) : null}

          {emailStep === "idle" ? (
            <Form {...emailForm}>
              <form
                className="mt-4 space-y-4"
                onSubmit={emailForm.handleSubmit(onStartEmailChange)}
              >
                <FormField
                  control={emailForm.control}
                  name="email"
                  render={EmailFieldRenderer}
                />
                <div className="flex justify-end">
                  <LoadingButton
                    className={BUTTON_CLASS}
                    loading={isEmailBusy}
                    type="submit"
                  >
                    Update Email
                  </LoadingButton>
                </div>
              </form>
            </Form>
          ) : null}

          {emailStep === "current" ? (
            <Form {...emailForm}>
              <form
                className="mt-4 space-y-4"
                onSubmit={emailForm.handleSubmit(onConfirmCurrentEmail)}
              >
                <FormField
                  control={emailForm.control}
                  disabled
                  name="email"
                  render={EmailFieldRenderer}
                />
                <FormField
                  control={emailForm.control}
                  name="otp"
                  render={OtpFieldRenderer}
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="text-muted-foreground hover:text-foreground text-sm font-medium"
                    onClick={onResendCurrentCode}
                    type="button"
                  >
                    Resend code
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-muted-foreground hover:text-foreground text-sm font-medium"
                      onClick={onCancelEmailChange}
                      type="button"
                    >
                      Cancel
                    </button>
                    <LoadingButton
                      className={BUTTON_CLASS}
                      loading={emailMutation.isPending}
                      type="submit"
                    >
                      Continue
                    </LoadingButton>
                  </div>
                </div>
              </form>
            </Form>
          ) : null}

          {emailStep === "new" ? (
            <Form {...emailVerifyForm}>
              <form
                className="mt-4 space-y-4"
                onSubmit={emailVerifyForm.handleSubmit(onVerifyNewEmail)}
              >
                <FormItem>
                  <FormLabel>New email</FormLabel>
                  <FormControl>
                    <Input
                      className="premium-input h-10 rounded-xl text-sm"
                      disabled
                      value={pendingNewEmail ?? ""}
                      readOnly
                    />
                  </FormControl>
                </FormItem>
                <FormField
                  control={emailVerifyForm.control}
                  name="otp"
                  render={OtpFieldRenderer}
                />
                <div className="flex justify-end gap-2">
                  <button
                    className="text-muted-foreground hover:text-foreground text-sm font-medium"
                    onClick={onCancelEmailChange}
                    type="button"
                  >
                    Cancel
                  </button>
                  <LoadingButton
                    className={BUTTON_CLASS}
                    loading={emailVerifyMutation.isPending}
                    type="submit"
                  >
                    Verify &amp; Change
                  </LoadingButton>
                </div>
              </form>
            </Form>
          ) : null}
        </div>
      </SettingsCard>

      <section className="scroll-mt-24 space-y-3" id="settings-linked-accounts">
        <CardHeading
          description="Add another way to sign in"
          icon={KeyRound}
          title="Sign-in methods"
        />
        <LinkedAccounts
          accountLinkingReadiness={accountLinkingReadiness}
          onLink={handleSocialLink}
          user={user}
        />
      </section>

      {!accountLinkingReadiness.hasPassword && (
        <SettingsCard className="scroll-mt-24" id="settings-add-password">
          <CardHeading
            description="Add a backup way to sign in before connecting another provider"
            icon={KeyRound}
            title="Add a Password"
          />

          {accountLinkingReadiness.hasVerifiedEmail ? (
            <Form {...passwordSetupForm}>
              <form
                className="mt-4 space-y-4"
                onSubmit={passwordSetupForm.handleSubmit(onPasswordSetupSubmit)}
              >
                <FormField
                  control={passwordSetupForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="new-password"
                          className="premium-input h-10 rounded-xl text-sm"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordSetupForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="new-password"
                          className="premium-input h-10 rounded-xl text-sm"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end">
                  <LoadingButton
                    className={BUTTON_CLASS}
                    loading={isSettingPassword}
                    type="submit"
                  >
                    Add Password
                  </LoadingButton>
                </div>
              </form>
            </Form>
          ) : (
            <p className="text-muted-foreground mt-4 text-sm">
              Add and verify an email address above first. This protects your
              account if you lose access to a connected provider.
            </p>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
