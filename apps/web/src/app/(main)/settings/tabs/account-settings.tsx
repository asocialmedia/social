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
import { Separator } from "@asm/ui/shadui/separator";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { type ControllerRenderProps, useForm } from "react-hook-form";
import { z } from "zod";
import { LoadingButton } from "@/components/auth/loading-button";
import LinkAccountAlert from "@/components/settings/link-account-alert";
import LinkedAccounts from "@/components/settings/linked-accounts";
import { useToast } from "@/lib/gooey-toast";
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

function UsernameFieldRenderer({
  field,
}: {
  field: ControllerRenderProps<UsernameFormValues, "username">;
}) {
  return (
    <FormItem>
      <FormLabel>Username</FormLabel>
      <FormControl>
        <Input {...field} />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

function EmailFieldRenderer({
  field,
}: {
  field: ControllerRenderProps<EmailFormValues, "email">;
}) {
  return (
    <FormItem>
      <FormLabel>Email</FormLabel>
      <FormControl>
        <Input {...field} type="email" />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

interface AccountSettingsProps {
  user: UserData;
}

export default function AccountSettings({ user }: AccountSettingsProps) {
  const { toast } = useToast();
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);

  const usernameForm = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameSchema),
    defaultValues: {
      username: user.username,
    },
  });

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      email: user.email || "",
    },
  });

  const usernameMutation = useUpdateUsername();
  const emailMutation = useUpdateEmail();

  function onUsernameSubmit(values: UsernameFormValues) {
    if (values.username === user.username) {
      toast({
        title: "No Changes",
        description: "That username is already yours, pick a new one",
      });
      return;
    }

    usernameMutation.mutate(values, {
      onSuccess: () => {
        toast({
          title: "Username Updated",
          description: "Your new username is live!",
        });
      },
    });
  }

  function onEmailSubmit(values: EmailFormValues) {
    if (values.email === user.email) {
      toast({
        title: "No Changes",
        description: "That's already your email, try a new one",
      });
      return;
    }

    emailMutation.mutate(values, {
      onSuccess: () => {
        setVerificationEmailSent(true);
        toast({
          title: "Check Your Inbox",
          description: "We sent a verification link to your new email",
        });
      },
    });
  }

  const handleSocialLink = (provider: string) => {
    window.location.href = `/api/auth/link/${provider}`;
  };

  return (
    <div className="space-y-8">
      <LinkAccountAlert />

      <div>
        <h2 className="font-medium text-lg">Account Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage your account settings and linked accounts
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="font-medium">Username</h3>
        <Form {...usernameForm}>
          <form
            className="space-y-4"
            onSubmit={usernameForm.handleSubmit(onUsernameSubmit)}
          >
            <FormField
              control={usernameForm.control}
              name="username"
              render={UsernameFieldRenderer}
            />

            <LoadingButton loading={usernameMutation.isPending} type="submit">
              Update Username
            </LoadingButton>
          </form>
        </Form>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="font-medium">Email Address</h3>
        <Form {...emailForm}>
          <form
            className="space-y-4"
            onSubmit={emailForm.handleSubmit(onEmailSubmit)}
          >
            <FormField
              control={emailForm.control}
              name="email"
              render={EmailFieldRenderer}
            />

            <LoadingButton
              disabled={verificationEmailSent}
              loading={emailMutation.isPending}
              type="submit"
            >
              {verificationEmailSent
                ? "Verification Email Sent"
                : "Update Email"}
            </LoadingButton>
          </form>
        </Form>
      </div>

      <Separator />

      <LinkedAccounts onLink={handleSocialLink} user={user} />
    </div>
  );
}
