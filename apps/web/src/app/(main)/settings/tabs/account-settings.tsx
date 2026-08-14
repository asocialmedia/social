"use client";

import type { UserData } from "@asm/db";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";
import { z } from "zod";

import LoadingButton from "@/components/auth/loading-button";
import LinkAccountAlert from "@/components/settings/link-account-alert";
import LinkedAccounts from "@/components/settings/linked-accounts";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

import { useUpdateEmail, useUpdateUsername } from "../mutations";

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
});

type UsernameFormValues = z.infer<typeof usernameSchema>;
type EmailFormValues = z.infer<typeof emailSchema>;

function handleSocialLink(provider: string) {
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
        type="email"
        {...field}
      />
    </FormControl>
    <FormMessage />
  </FormItem>
);

interface AccountSettingsProps {
  user: UserData;
}

export default function AccountSettings({ user }: AccountSettingsProps) {
  const { toast } = useToast();
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);

  const usernameForm = useForm<UsernameFormValues>({
    defaultValues: {
      username: user.username,
    },
    resolver: zodResolver(usernameSchema),
  });

  const emailForm = useForm<EmailFormValues>({
    defaultValues: {
      email: user.email || "",
    },
    resolver: zodResolver(emailSchema),
  });

  const usernameMutation = useUpdateUsername();
  const emailMutation = useUpdateEmail();

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

  function onEmailSubmit(values: EmailFormValues) {
    if (values.email === user.email) {
      toast({
        description: "That's already your email, try a new one",
        title: "No Changes",
      });
      return;
    }

    emailMutation.mutate(values, {
      onError: () => {
        toast({
          description: "That email didn't work, try another?",
          title: "Couldn't Update",
          variant: "destructive",
        });
      },
      onSuccess: () => {
        setVerificationEmailSent(true);
        toast({
          description: "We sent a verification link to your new email",
          title: "Check Your Inbox",
        });
      },
    });
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="Your username, email and linked accounts"
        icon={AtSign}
        title="Account"
      />

      <LinkAccountAlert />

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
              How people find you on Asocialmedia
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
              name="email"
              render={EmailFieldRenderer}
            />

            <div className="flex justify-end">
              <LoadingButton
                className={BUTTON_CLASS}
                disabled={verificationEmailSent}
                loading={emailMutation.isPending}
                type="submit"
              >
                {verificationEmailSent
                  ? "Verification Email Sent"
                  : "Update Email"}
              </LoadingButton>
            </div>
          </form>
        </Form>
      </SettingsCard>

      <SettingsCard className="scroll-mt-24" id="settings-linked-accounts">
        <LinkedAccounts onLink={handleSocialLink} user={user} />
      </SettingsCard>
    </div>
  );
}
