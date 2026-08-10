"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { USERNAME_REGEX } from "@asm/auth/validation";
import type { UserData } from "@asm/db";
import { useToast } from "@asm/ui/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import { KeyRound, Mail } from "lucide-react";
import { motion } from "motion/react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { requestPasswordReset } from "@/app/(auth)/reset-password/server-actions";
import { LoadingButton } from "@/components/auth/loading-button";

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
  user: UserData;
}

export default function SecuritySettings({ user }: SecuritySettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [isEmailSent, setIsEmailSent] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(identifierSchema),
    defaultValues: {
      identifier: user.email || user.username || "",
    },
  });

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await requestPasswordReset(values);

      if (result.error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: result.error,
        });
        return;
      }

      setIsEmailSent(true);
      toast({
        title: "Email Sent",
        description: "Check your email for password reset instructions",
      });
    });
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
      initial={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="relative overflow-hidden rounded-lg border border-border/50 bg-background/30 p-6 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="rounded-full bg-primary/10 p-3">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="bg-gradient-to-r from-primary to-secondary bg-clip-text font-medium text-lg text-transparent">
              Security Settings
            </h2>
            <p className="text-muted-foreground text-sm">
              Manage your account security
            </p>
          </div>
        </div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 space-y-4"
          initial={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-medium">Change Password</h3>
          </div>

          <div className="relative rounded-md border border-border/50 bg-background/20 p-6 backdrop-blur-sm">
            <Form {...form}>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit(onSubmit)}
              >
                <FormField
                  control={form.control}
                  name="identifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username or Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="bg-background/50 backdrop-blur-xs transition-all duration-200 hover:bg-background/70 focus:bg-background/70"
                          disabled={isEmailSent}
                          placeholder="Enter your username or email to reset password"
                          type="text"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <LoadingButton
                  className="w-full sm:w-auto"
                  disabled={isEmailSent}
                  loading={isPending}
                  type="submit"
                >
                  {isEmailSent ? "Email Sent" : "Send Reset Link"}
                </LoadingButton>
              </form>
            </Form>

            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-secondary/5 to-background blur-xl" />
          </div>
        </motion.div>

        <div className="absolute inset-0 -z-20 bg-gradient-to-br from-primary/5 via-secondary/5 to-background blur-3xl" />
      </div>
    </motion.div>
  );
}
