"use client";

import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
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
import { Separator } from "@asm/ui/shadui/separator";
import { Textarea } from "@asm/ui/shadui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link2, UserRound } from "lucide-react";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import type { Control, ControllerRenderProps } from "react-hook-form";
import type { IconType } from "react-icons";
import { FaGithub, FaLinkedin, FaReddit, FaXTwitter } from "react-icons/fa6";

import { LoadingButton } from "@/components/auth/loading-button";
import UserAvatar from "@/components/layouts/user-avatar";
import { AnimatedWordCounter } from "@/components/misc/animated-word-counter";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import { useUpdateProfileMutation } from "../../users/[username]/avatar-mutations";

const whitespaceRegex = /\s+/;

interface SocialFieldConfig {
  icon: IconType;
  label: string;
  name:
    | "githubUsername"
    | "linkedinUsername"
    | "twitterUsername"
    | "redditUsername";
  placeholder: string;
}

const SOCIAL_FIELDS: SocialFieldConfig[] = [
  {
    icon: FaGithub,
    label: "GitHub",
    name: "githubUsername",
    placeholder: "octocat",
  },
  {
    icon: FaLinkedin,
    label: "LinkedIn",
    name: "linkedinUsername",
    placeholder: "john-doe",
  },
  {
    icon: FaXTwitter,
    label: "Twitter / X",
    name: "twitterUsername",
    placeholder: "yourhandle",
  },
  {
    icon: FaReddit,
    label: "Reddit",
    name: "redditUsername",
    placeholder: "yourusername",
  },
];

const DisplayNameFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<UpdateUserProfileValues, "displayName">;
}) => (
  <FormItem>
    <FormLabel>Display name</FormLabel>
    <FormControl>
      <Input
        className="premium-input h-10 rounded-xl text-sm"
        placeholder="Your display name"
        {...field}
      />
    </FormControl>
    <FormMessage />
  </FormItem>
);

const BioFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<UpdateUserProfileValues, "bio">;
}) => (
  <FormItem>
    <FormLabel>Bio</FormLabel>
    <FormControl>
      <div className="space-y-1">
        <Textarea
          className="premium-input resize-none rounded-xl text-sm"
          placeholder="Tell us a little bit about yourself"
          rows={4}
          {...field}
        />
        <div className="flex justify-end">
          <AnimatedWordCounter
            current={
              field.value.trim().split(whitespaceRegex).filter(Boolean).length
            }
            max={400}
          />
        </div>
      </div>
    </FormControl>
    <FormMessage />
  </FormItem>
);

const SocialFieldRenderer = ({
  field,
  item,
}: {
  field: ControllerRenderProps<
    UpdateUserProfileValues,
    SocialFieldConfig["name"]
  >;
  item: SocialFieldConfig;
}) => {
  const Icon = item.icon;
  return (
    <FormItem>
      <FormLabel>{item.label}</FormLabel>
      <FormControl>
        <div className="relative">
          <Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            className="premium-input h-10 rounded-xl pr-3 pl-10 text-sm"
            placeholder={item.placeholder}
            {...field}
          />
        </div>
      </FormControl>
      <FormMessage />
    </FormItem>
  );
};

const SocialFormField = ({
  control,
  item,
}: {
  control: Control<UpdateUserProfileValues>;
  item: SocialFieldConfig;
}) => {
  const renderSocialField = useCallback(
    ({
      field,
    }: {
      field: ControllerRenderProps<
        UpdateUserProfileValues,
        SocialFieldConfig["name"]
      >;
    }) => <SocialFieldRenderer field={field} item={item} />,
    [item]
  );

  return (
    <FormField control={control} name={item.name} render={renderSocialField} />
  );
};

interface ProfileSettingsProps {
  user: PrivateUserData;
}

export default function ProfileSettings({ user }: ProfileSettingsProps) {
  const { toast } = useToast();
  const form = useForm<UpdateUserProfileValues>({
    defaultValues: {
      bio: user.bio || "",
      displayName: user.displayName,
      githubUsername: user.githubUsername ?? "",
      linkedinUsername: user.linkedinUsername ?? "",
      redditUsername: user.redditUsername ?? "",
      twitterUsername: user.twitterUsername ?? "",
    },
    resolver: zodResolver(updateUserProfileSchema),
  });

  // oxlint-disable-next-line react/incompatible-library -- react-hook-form watch handle is unmemoizable by design; compiler skips this component
  const watchedDisplayName = form.watch("displayName");
  const watchedBio = form.watch("bio");

  const mutation = useUpdateProfileMutation();

  function onSubmit(values: UpdateUserProfileValues) {
    mutation.mutate(
      {
        userId: user.id,
        values,
      },
      {
        onError: () => {
          toast({
            description: "Something went wrong, try again?",
            title: "Couldn't Save",
            variant: "destructive",
          });
        },
        onSuccess: () => {
          toast({
            description: "Your profile is looking fresh!",
            title: "Profile Updated",
          });
        },
      }
    );
  }

  const avatarUrl = user.avatarUrl ? getSecureImageUrl(user.avatarUrl) : null;
  const previewName = watchedDisplayName.trim() || user.username;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="How you appear across asocialmedia"
        icon={UserRound}
        title="Profile"
      />

      <SettingsCard className="scroll-mt-24" id="settings-profile">
        <div className="flex items-center gap-4">
          <UserAvatar avatarUrl={avatarUrl} className="h-16 w-16" size={64} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{previewName}</p>
            <p className="text-muted-foreground truncate">@{user.username}</p>
            {watchedBio.trim() ? (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {watchedBio}
              </p>
            ) : null}
          </div>
        </div>

        <Separator className="bg-border/60 my-6" />

        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="displayName"
              render={DisplayNameFieldRenderer}
            />

            <FormField
              control={form.control}
              name="bio"
              render={BioFieldRenderer}
            />

            <div className="pt-1">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    ORANGE_GRADIENT_CLASS
                  )}
                >
                  <Link2 className="h-3.5 w-3.5" />
                </div>
                <p className="text-sm font-medium">Social links</p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {SOCIAL_FIELDS.map((item) => (
                  <SocialFormField
                    control={form.control}
                    item={item}
                    key={item.name}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <LoadingButton
                className={cn(
                  "h-10 rounded-xl px-6",
                  ORANGE_GRADIENT_CLASS,
                  "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
                )}
                loading={mutation.isPending}
                type="submit"
              >
                Save Changes
              </LoadingButton>
            </div>
          </form>
        </Form>
      </SettingsCard>
    </div>
  );
}
