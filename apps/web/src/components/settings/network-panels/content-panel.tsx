"use client";

import { interestSchema } from "@asm/protocols/discovery";
import { Sparkles, X } from "lucide-react";

import {
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";

import type { NetworkPanelProps } from "./panel-props";
import { TopicPicker } from "./topic-picker";

export default function ContentPanel({
  isSaving,
  persona,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const updateInterests = (interests: string[]) =>
    save({
      ...preferences,
      profiles: preferences.profiles.map((entry) =>
        entry.id === profile.id ? { ...entry, interests } : entry
      ),
    });
  const toggleInterest = (topic: string) => {
    const parsed = interestSchema.safeParse(topic);
    if (!parsed.success) {
      return;
    }
    updateInterests(
      profile.interests.includes(parsed.data)
        ? profile.interests.filter((interest) => interest !== parsed.data)
        : [...profile.interests, parsed.data].slice(0, 32)
    );
  };
  return (
    <SettingsCard className="space-y-4" id="settings-network-interests">
      <SettingsCardHeading
        description={`Choose interests for ${profile.name}. Your feeds include related subjects discovered from these topics. Explore a topic to see up to 10 more.`}
        icon={Sparkles}
        title="Interests"
      />
      <TopicPicker
        disabled={isSaving}
        label="Find or add an interest"
        limit={32}
        onToggle={toggleInterest}
        selected={profile.interests}
      />
      <div aria-label="Chosen interests" className="flex flex-wrap gap-2">
        {profile.interests.map((topic) => (
          <button
            aria-label={`Remove interest ${topic}`}
            className="chip-3d text-primary focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-full! px-3 py-1.5 text-sm focus-visible:ring-2 disabled:opacity-50"
            disabled={isSaving}
            key={topic}
            onClick={() => toggleInterest(topic)}
            type="button"
          >
            {topic} <X className="size-3" />
          </button>
        ))}
      </div>
      <div
        aria-live="polite"
        className="text-muted-foreground space-y-2 text-xs"
      >
        <p>
          {profile.interests.length}/32 chosen · {persona.signalCount} recent
          interactions
        </p>
        {persona.learnedInterests.length ? (
          <p>Recent activity signals: {persona.learnedInterests.join(", ")}</p>
        ) : (
          <p>
            Your activity on ASM and connected networks will help this profile
            discover more.
          </p>
        )}
        {persona.relatedInterests.length ? (
          <p>
            Topic suggestions from activity:{" "}
            {persona.relatedInterests.join(", ")}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
