"use client";

import { USERNAME_REGEX } from "@asm/auth/validation";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Mail } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";
import { z } from "zod";

import { requestPasswordReset } from "@/app/(auth)/reset-password/server-actions";
import LoadingButton from "@/components/auth/loading-button";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

const identifierSchema = z.object({
  identifier: z.union([
    z.email("Please enter a valid email address"),
    z
      .string()
      .regex(
        USERNAME_REGEX,
        "Username can only contain letters, numbers, and underscores"
      ),
  ]),
});

type FormValues = z.infer<typeof identifierSchema>;

interface SecuritySettingsProps {
  user: PrivateUserData;
}

export default function SecuritySettings({ user }: SecuritySettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [isEmailSent, setIsEmailSent] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    defaultValues: {
      identifier: user.email || user.username || "",
    },
    resolver: zodResolver(identifierSchema),
  });

  const renderIdentifierField = useCallback(
    ({ field }: { field: ControllerRenderProps<FormValues, "identifier"> }) => (
      <FormItem>
        <FormLabel>Username or Email</FormLabel>
        <FormControl>
          <Input
            className="premium-input h-10 rounded-xl text-sm"
            disabled={isEmailSent}
            placeholder="Enter your username or email to reset password"
            type="text"
            {...field}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    [isEmailSent]
  );

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await requestPasswordReset(values);

      if (result.error) {
        toast({
          description: result.error,
          title: "Couldn't Send",
          variant: "destructive",
        });
        return;
      }

      setIsEmailSent(true);
      toast({
        description: "Check your inbox for the reset link",
        title: "Email Sent",
      });
    });
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="Keep your account safe"
        icon={KeyRound}
        title="Security"
      />

      <SettingsCard className="scroll-mt-24" id="settings-password">
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
            <h3 className="font-medium">Change Password</h3>
            <p className="text-muted-foreground text-sm">
              We&apos;ll email you a secure reset link
            </p>
          </div>
        </div>

        <Form {...form}>
          <form
            className="mt-4 space-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="identifier"
              render={renderIdentifierField}
            />

            <div className="flex justify-end">
              <LoadingButton
                className={cn(
                  "h-9 rounded-xl px-5",
                  ORANGE_GRADIENT_CLASS,
                  "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
                )}
                disabled={isEmailSent}
                loading={isPending}
                type="submit"
              >
                {isEmailSent ? "Email Sent" : "Send Reset Link"}
              </LoadingButton>
            </div>
          </form>
        </Form>
      </SettingsCard>
    </div>
  );
}
