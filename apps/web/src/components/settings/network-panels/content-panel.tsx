"use client";

import { interestSchema } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Check, Plus, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";
import { cn } from "@/lib/utils";

import type { NetworkPanelProps } from "./panel-props";

export default function ContentPanel({
  catalog,
  isSaving,
  persona,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const [search, setSearch] = useState("");
  const choices = [...new Set([...profile.interests, ...catalog])].filter(
    (topic) => topic.toLowerCase().includes(search.toLowerCase())
  );
  const custom = interestSchema.safeParse(search);
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
        description={`Choose interests for ${profile.name}. Add any topic; these suggestions are a starting point.`}
        icon={Sparkles}
        title="Interests"
      />
      <Input
        aria-label="Find or add an interest"
        maxLength={64}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Find or add an interest…"
        value={search}
      />
      <div aria-label="Interest choices" className="flex flex-wrap gap-2">
        {choices.map((topic) => (
          <button
            aria-pressed={profile.interests.includes(topic)}
            className={cn(
              "chip-3d focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-full! px-3 py-1.5 text-sm focus-visible:ring-2 disabled:opacity-50",
              profile.interests.includes(topic) && "text-primary"
            )}
            disabled={
              isSaving ||
              (!profile.interests.includes(topic) &&
                profile.interests.length >= 32)
            }
            key={topic}
            onClick={() => toggleInterest(topic)}
            type="button"
          >
            {profile.interests.includes(topic) ? (
              <Check className="size-3" />
            ) : null}
            {topic}
          </button>
        ))}
      </div>
      {custom.success &&
      !catalog.includes(custom.data) &&
      !profile.interests.includes(custom.data) ? (
        <Button
          disabled={isSaving || profile.interests.length >= 32}
          onClick={() => {
            toggleInterest(custom.data);
            setSearch("");
          }}
          size="sm"
          variant="outline"
        >
          <Plus className="size-3.5" />
          Add “{custom.data}”
        </Button>
      ) : null}
      <div
        aria-live="polite"
        className="text-muted-foreground space-y-2 text-xs"
      >
        <p>
          {profile.interests.length}/32 chosen · {persona.signalCount} recent
          interactions
        </p>
        {persona.learnedInterests.length ? (
          <p>
            Learning from your activity: {persona.learnedInterests.join(", ")}
          </p>
        ) : (
          <p>
            Your activity on ASM and connected networks will help this profile
            discover more.
          </p>
        )}
        {persona.relatedInterests.length ? (
          <p>
            Related interests discovered: {persona.relatedInterests.join(", ")}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
