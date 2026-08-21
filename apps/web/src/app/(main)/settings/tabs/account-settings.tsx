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
import { AtSign, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";
import { z } from "zod";

import LoadingButton from "@/components/auth/loading-button";
import AddEmailBanner from "@/components/settings/add-email-banner";
import LinkAccountAlert from "@/components/settings/link-account-alert";
import LinkedAccounts from "@/components/settings/linked-accounts";
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

type UsernameFormValues = z.infer<typeof usernameSchema>;
type EmailFormValues = z.infer<typeof emailSchema>;
type EmailVerifyFormValues = z.infer<typeof emailVerifySchema>;

function handleSocialLink(provider: string) {
  // Navigate to the link route which starts the OAuth flow with the user's
  // session and redirects back to the provider's authorization page.
  window.location.href = `/api/auth/link/${provider}`;
}

const BUTTON_CLASS = cn(
  "h-9 rounded-xl px-5",
  ORANGE_GRADIENT_CLASS,
  "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
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
  user: PrivateUserData;
}

export default function AccountSettings({ user }: AccountSettingsProps) {
  const { toast } = useToast();
  // When true, the current-email verification code has been sent and the new
  // email + current code are ready to submit.
  const [currentEmailCodeSent, setCurrentEmailCodeSent] = useState(false);
  // When true, the OTP step for confirming the new email is shown.
  const [emailChangeRequested, setEmailChangeRequested] = useState(false);
  const [pendingNewEmail, setPendingNewEmail] = useState<string | null>(null);

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

  const usernameMutation = useUpdateUsername();
  const emailMutation = useUpdateEmail();
  const emailVerifyMutation = useVerifyEmailChange();
  const sendCurrentEmailCodeMutation = useSendCurrentEmailCode();

  function onUsernameSubmit(values: UsernameFormValues) {
    if (values.username === user.username) {
      toast({
        description: "That username is already yours, pick a new one",
        title: "No Changes",
      });
      return;
    }

    usernameMutation.mutate(values, {
      onError: () => {
        toast({
          description: "That username didn't work, try another?",
          title: "Couldn't Update",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        toast({
          description: "Your new username is live!",
          title: "Username Updated",
        });
      },
    });
  }

  function handleSendCurrentEmailCode() {
    sendCurrentEmailCodeMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          description: error.message || "Couldn't send the code, try again?",
          title: "Couldn't Send Code",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        setCurrentEmailCodeSent(true);
        toast({
          description: "Check your current email for the verification code",
          title: "Code Sent",
        });
      },
    });
  }

  function onEmailSubmit(values: EmailFormValues) {
    if (values.email === user.email) {
      toast({
        description: "That's already your email, try a new one",
        title: "No Changes",
      });
      return;
    }

    // Accounts with an existing email must include the code that was sent to
    // it before the change can start.
    const payload = { email: values.email, otp: values.otp };

    emailMutation.mutate(payload, {
      onError: () => {
        toast({
          description: "That email didn't work, try another?",
          title: "Couldn't Update",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        setEmailChangeRequested(true);
        setPendingNewEmail(values.email);
        emailVerifyForm.setValue("email", values.email);
        toast({
          description:
            "We sent a code to your new email - enter it to confirm the change",
          title: "Check Your Inbox",
        });
      },
    });
  }

  function onEmailVerifySubmit(values: EmailVerifyFormValues) {
    emailVerifyMutation.mutate(values, {
      onError: (error) => {
        toast({
          description: error.message || "That code didn't work, try again?",
          title: "Couldn't Verify",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        setEmailChangeRequested(false);
        setPendingNewEmail(null);
        toast({
          description: "Your email is updated and verified!",
          title: "Email Updated",
        });
      },
    });
  }

  function onCancelEmailChange() {
    setEmailChangeRequested(false);
    setPendingNewEmail(null);
    emailForm.setValue("email", user.email || "");
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="Your username, email and linked accounts"
        icon={AtSign}
        title="Account"
      />

      <LinkAccountAlert />

      {/* Reddit never shares an email; accounts created through it have no
          recovery address, so prompt them to add one. */}
      {user.redditId && !user.email ? <AddEmailBanner /> : null}

      <SettingsCard className="scroll-mt-24" id="settings-username">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              ORANGE_GRADIENT_CLASS
            )}
          >
            <AtSign className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="font-medium">Username</h3>
            <p className="text-muted-foreground text-sm">
              How people find you on asocialmedia
            </p>
          </div>
        </div>

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
      </SettingsCard>

      <SettingsCard className="scroll-mt-24" id="settings-email">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              ORANGE_GRADIENT_CLASS
            )}
          >
            <Mail className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="font-medium">Email Address</h3>
            <p className="text-muted-foreground text-sm">
              Where we send login and reset links
            </p>
          </div>
        </div>

        <Form {...emailForm}>
          <form
            className="mt-4 space-y-4"
            onSubmit={emailForm.handleSubmit(onEmailSubmit)}
          >
            <FormField
              control={emailForm.control}
              disabled={emailChangeRequested}
              name="email"
              render={EmailFieldRenderer}
            />

            {user.email && !emailChangeRequested ? (
              <div className="space-y-3">
                {/* The code input only appears once the mail has been sent. */}
                {currentEmailCodeSent ? (
                  <FormField
                    control={emailForm.control}
                    disabled={emailChangeRequested}
                    name="otp"
                    render={OtpFieldRenderer}
                  />
                ) : null}
                <div className="flex justify-start">
                  <LoadingButton
                    className="h-10 shrink-0 rounded-xl px-4 text-xs"
                    loading={sendCurrentEmailCodeMutation.isPending}
                    onClick={handleSendCurrentEmailCode}
                    type="button"
                    variant="outline"
                  >
                    {currentEmailCodeSent
                      ? "Resend code"
                      : "Send code to current email"}
                  </LoadingButton>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <LoadingButton
                className={BUTTON_CLASS}
                disabled={
                  emailChangeRequested ||
                  (Boolean(user.email) &&
                    (!currentEmailCodeSent ||
                      (emailForm.watch("otp")?.length ?? 0) < 6))
                }
                loading={emailMutation.isPending}
                type="submit"
              >
                {emailChangeRequested ? "Code Sent" : "Update Email"}
              </LoadingButton>
            </div>
          </form>
        </Form>

        {emailChangeRequested && (
          <div className="border-border/60 mt-4 rounded-xl border p-4">
            <p className="mb-3 text-sm">
              Enter the verification code we sent to{" "}
              <span className="font-medium">{pendingNewEmail}</span> to confirm
              the change.
            </p>
            <Form {...emailVerifyForm}>
              <form
                className="space-y-3"
                onSubmit={emailVerifyForm.handleSubmit(onEmailVerifySubmit)}
              >
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
                    Verify & Change
                  </LoadingButton>
                </div>
              </form>
            </Form>
          </div>
        )}
      </SettingsCard>

      <SettingsCard className="scroll-mt-24" id="settings-linked-accounts">
        <LinkedAccounts onLink={handleSocialLink} user={user} />
      </SettingsCard>
    </div>
  );
}
