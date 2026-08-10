"use client";

import {
  type UpdateUserProfileValues,
  updateUserProfileSchema,
} from "@asm/auth/validation";
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
import { Textarea } from "@asm/ui/shadui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserCircle } from "lucide-react";
import { motion } from "motion/react";
import { type ControllerRenderProps, useForm } from "react-hook-form";
import { LoadingButton } from "@/components/auth/loading-button";
import { useUpdateProfileMutation } from "../../users/[username]/avatar-mutations";

function DisplayNameFieldRenderer({
  field,
}: {
  field: ControllerRenderProps<UpdateUserProfileValues, "displayName">;
}) {
  return (
    <FormItem>
      <FormLabel>Display Name</FormLabel>
      <FormControl>
        <Input
          {...field}
          className="bg-background/50 backdrop-blur-xs transition-all duration-200 hover:bg-background/70 focus:bg-background/70"
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

function BioFieldRenderer({
  field,
}: {
  field: ControllerRenderProps<UpdateUserProfileValues, "bio">;
}) {
  return (
    <FormItem>
      <FormLabel>Bio</FormLabel>
      <FormControl>
        <Textarea
          {...field}
          className="min-h-[120px] resize-none bg-background/50 backdrop-blur-xs transition-all duration-200 hover:bg-background/70 focus:bg-background/70"
          placeholder="Tell us about yourself"
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

interface ProfileSettingsProps {
  user: UserData;
}

export default function ProfileSettings({ user }: ProfileSettingsProps) {
  const { toast } = useToast();
  const form = useForm<UpdateUserProfileValues>({
    resolver: zodResolver(updateUserProfileSchema),
    defaultValues: {
      displayName: user.displayName,
      bio: user.bio || "",
    },
  });

  const mutation = useUpdateProfileMutation();

  function onSubmit(values: UpdateUserProfileValues) {
    mutation.mutate(
      {
        values,
        userId: user.id,
      },
      {
        onSuccess: () => {
          toast({
            title: "Profile updated",
            description: "Your profile has been updated successfully",
          });
        },
      }
    );
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
            <UserCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="bg-gradient-to-r from-primary to-secondary bg-clip-text font-medium text-lg text-transparent">
              Profile Information
            </h2>
            <p className="text-muted-foreground text-sm">
              Update your profile information
            </p>
          </div>
        </div>

        <Form {...form}>
          <form
            className="mt-6 space-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              initial={{ opacity: 0, x: -20 }}
              transition={{ delay: 0.1 }}
            >
              <FormField
                control={form.control}
                name="displayName"
                render={DisplayNameFieldRenderer}
              />
            </motion.div>

            <motion.div
              animate={{ opacity: 1, x: 0 }}
              initial={{ opacity: 0, x: -20 }}
              transition={{ delay: 0.2 }}
            >
              <FormField
                control={form.control}
                name="bio"
                render={BioFieldRenderer}
              />
            </motion.div>

            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="pt-2"
              initial={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.3 }}
            >
              <LoadingButton
                className="w-full sm:w-auto"
                loading={mutation.isPending}
                type="submit"
              >
                Save Changes
              </LoadingButton>
            </motion.div>
          </form>
        </Form>

        {/* Gradient background effect */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-secondary/5 to-background blur-3xl" />
      </div>
    </motion.div>
  );
}
