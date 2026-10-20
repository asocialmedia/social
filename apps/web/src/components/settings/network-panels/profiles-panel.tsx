"use client";

import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Brain, Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";

import type { NetworkPanelProps } from "./panel-props";

export default function ProfilesPanel({
  isSaving,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const [profileName, setProfileName] = useState("");
  return (
    <SettingsCard className="space-y-4" id="settings-network-profiles">
      <SettingsCardHeading
        description="Different sides of you, with their own interests and recent activity."
        icon={Brain}
        title="Recommendation profiles"
      />
      <div
        aria-label="Recommendation profiles"
        className="flex flex-wrap gap-2"
      >
        {preferences.profiles.map((entry) => (
          <Button
            aria-pressed={entry.id === profile.id}
            disabled={isSaving}
            key={entry.id}
            onClick={() => save({ ...preferences, activeProfileId: entry.id })}
            size="sm"
            variant={entry.id === profile.id ? "premium" : "outline"}
          >
            {entry.id === profile.id ? <Check className="size-3.5" /> : null}
            {entry.name}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!profileName.trim() || preferences.profiles.length >= 8) {
            return;
          }
          const created = {
            id: crypto.randomUUID(),
            interests: [],
            name: profileName.trim(),
          };
          save({
            ...preferences,
            activeProfileId: created.id,
            profiles: [...preferences.profiles, created],
          });
          setProfileName("");
        }}
      >
        <Input
          aria-label="New recommendation profile name"
          maxLength={40}
          onChange={(event) => setProfileName(event.target.value)}
          placeholder="Name a profile, e.g. Studio or After hours"
          value={profileName}
        />
        <Button
          disabled={
            isSaving || !profileName.trim() || preferences.profiles.length >= 8
          }
          type="submit"
          variant="premium"
        >
          <Plus className="size-4" />
          Create
        </Button>
      </form>
      {preferences.profiles.length > 1 ? (
        <Button
          disabled={isSaving}
          onClick={() => {
            const profiles = preferences.profiles.filter(
              (entry) => entry.id !== profile.id
            );
            save({
              ...preferences,
              activeProfileId: profiles[0]?.id ?? "default",
              profiles,
            });
          }}
          size="sm"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
          Delete {profile.name}
        </Button>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Chosen interests stay. Recent activity fades over 30 days. Switch
        profiles from Home’s feed settings.
      </p>
    </SettingsCard>
  );
}
