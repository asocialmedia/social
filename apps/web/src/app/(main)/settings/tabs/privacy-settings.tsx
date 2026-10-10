"use client";

import type { GroupAddPolicy } from "@asm/db/messages/dens";
import { Label } from "@asm/ui/shadui/label";
import { RadioGroup, RadioGroupItem } from "@asm/ui/shadui/radio-group";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Users } from "lucide-react";
import { useState } from "react";

import {
  SETTINGS_SUBCARD_CLASS,
  SettingsCard,
  SettingsCardHeading,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import type { PrivateUserData } from "@/hooks/users/use-user-data";
import { useToast } from "@/lib/gooey-toast";

interface PrivacySettingsProps {
  user: PrivateUserData;
}

// Who may put this account in a group without being asked.
//
// Three options and one note, because the note is the part that is easy to leave
// out and expensive to get wrong: the strictest option still leaves invite links
// working. Somebody who turns every door off has not locked themselves out of
// groups, and a settings page that implied otherwise would be lying about the
// product.
//
// The options are radio buttons rather than a Select because there are three of
// them and each carries a sentence explaining itself. A collapsed menu hides the
// explanation behind a second tap, which is where a privacy choice gets made
// without being read.
const GROUP_ADD_OPTIONS: {
  description: string;
  label: string;
  value: GroupAddPolicy;
}[] = [
  {
    description:
      "Anybody can add you to a group, whether or not you follow each other.",
    label: "Anyone",
    value: "EVERYONE",
  },
  {
    description: "Only people you already follow can add you to a group.",
    label: "Only people I follow",
    value: "FOLLOWING_ONLY",
  },
  {
    description:
      "Nobody can add you to a group directly. Invite links still work.",
    label: "No direct adds",
    value: "NO_DIRECT_ADDS",
  },
];

export default function PrivacySettings({ user }: PrivacySettingsProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const initial = user.groupAddPolicy;
  // Optimistic local state, because a radio group that snaps back to the old value
  // for the length of a round trip reads as the click being rejected. The
  // mutation below rolls it back if the save fails.
  const [selected, setSelected] = useState<GroupAddPolicy>(initial);

  const save = useMutation({
    mutationFn: async (policy: GroupAddPolicy) => {
      const response = await fetch("/api/users/privacy/group-add-policy", {
        body: JSON.stringify({ groupAddPolicy: policy }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Couldn't save that setting");
      }
      return (await response.json()) as { groupAddPolicy: GroupAddPolicy };
    },
    onError: (error, policy) => {
      setSelected(initial);
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't save that setting",
        title: "Couldn't save",
        variant: "destructive",
      });
      // Named only to keep the signature honest about what it rolled back to.
      void policy;
    },
    onSuccess: (data) => {
      setSelected(data.groupAddPolicy);
      void queryClient.invalidateQueries({ queryKey: ["user", user.id] });
      void queryClient.invalidateQueries({ queryKey: ["userData"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 sm:px-6">
      <SettingsSectionHeader
        description="Who can reach you, and who can put you in a group"
        icon={ShieldCheck}
        title="Privacy"
      />

      <SettingsCard className="flex flex-col gap-5" id="settings-group-adds">
        <SettingsCardHeading
          description="Applies to new groups. It never changes a group you are already in."
          icon={Users}
          title="Who can add me to a group"
        />

        <RadioGroup
          className="gap-2"
          onValueChange={(value) => {
            const policy = value as GroupAddPolicy;
            setSelected(policy);
            save.mutate(policy);
          }}
          value={selected}
        >
          {GROUP_ADD_OPTIONS.map((option) => {
            const optionId = `group-add-${option.value}`;
            return (
              // A div, not a label: the text is associated with the radio by
              // htmlFor rather than by wrapping it, so clicking the description
              // still selects text instead of swallowing the click.
              <div className={SETTINGS_SUBCARD_CLASS} key={option.value}>
                <div className="flex items-start gap-3 p-4">
                  <RadioGroupItem
                    className="mt-0.5"
                    id={optionId}
                    value={option.value}
                  />
                  <Label
                    className="min-w-0 flex-1 cursor-pointer"
                    htmlFor={optionId}
                  >
                    <span className="block text-sm font-medium">
                      {option.label}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-sm">
                      {option.description}
                    </span>
                  </Label>
                </div>
              </div>
            );
          })}
        </RadioGroup>

        <p className="text-muted-foreground text-xs">
          Invite links are not affected by this. Anyone you send one to can
          still open it and join, because joining is your decision rather than
          theirs.
        </p>
      </SettingsCard>
    </div>
  );
}
