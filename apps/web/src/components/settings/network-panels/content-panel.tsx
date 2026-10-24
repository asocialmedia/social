"use client";

import { interestSchema } from "@asm/protocols/discovery";
import { Network, Sparkles } from "lucide-react";

import type { NetworkPanelProps } from "./panel-props";
import { RecentActivityCard } from "./recent-activity-card";
import { SettingsPanelSection } from "./settings-panel-section";
import { SettingsPill } from "./settings-pill";
import { TopicPicker } from "./topic-picker";

export default function ContentPanel({
  isSaving,
  revision,
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
    const { interests: current } = profile;
    updateInterests(
      current.includes(parsed.data)
        ? current.filter((interest) => interest !== parsed.data)
        : [...current, parsed.data].slice(0, 32)
    );
  };
  const { interests } = profile;
  return (
    <>
      <SettingsPanelSection
        count={interests.length ? `${interests.length} of 32` : undefined}
        description={`Your feeds pull in related subjects discovered from these topics, for ${profile.name}.`}
        icon={Sparkles}
        id="settings-network-interests"
        title="Interests"
      >
        <div className="space-y-4 px-3">
          <TopicPicker
            disabled={false}
            label="Find or add an interest"
            limit={32}
            onToggle={toggleInterest}
            selected={interests}
          />

          {interests.length ? (
            <div aria-label="Chosen interests" className="flex flex-wrap gap-2">
              {interests.map((topic) => (
                <SettingsPill
                  disabled={isSaving}
                  key={topic}
                  label={topic}
                  onRemove={() => toggleInterest(topic)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Nothing chosen yet. Search above, or explore a suggestion to see
              up to ten related subjects.
            </p>
          )}
        </div>
      </SettingsPanelSection>

      <RecentActivityCard
        disabled={isSaving}
        persona={persona}
        profileId={profile.id}
        revision={revision}
      />

      <SettingsPanelSection
        description="Related subjects connected to this profile’s interests."
        icon={Network}
        id="settings-network-connections"
        title="Topic connections"
      >
        {persona.relatedInterests.length ? (
          <div className="flex flex-wrap gap-2 px-3">
            {persona.relatedInterests.map((topic) => (
              <span
                className="chip-3d rounded-full! px-3 py-1 text-sm"
                key={topic}
              >
                {topic}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground px-3 text-sm">
            Topic connections appear as you choose interests and browse.
          </p>
        )}
      </SettingsPanelSection>
    </>
  );
}
