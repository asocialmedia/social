"use client";

import { Label } from "@asm/ui/shadui/label";
import { Switch } from "@asm/ui/shadui/switch";
import { Ban, Shield, X } from "lucide-react";

import {
  SETTINGS_SUBCARD_CLASS,
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";
import { cn } from "@/lib/utils";

import type { NetworkPanelProps } from "./panel-props";
import { TopicPicker } from "./topic-picker";

export default function ModerationPanel({
  isSaving,
  persona,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  return (
    <>
      <SettingsCard className="space-y-4" id="settings-network-explicit">
        <SettingsCardHeading
          description="Off by default for new accounts. Applies to Home, Gusts, and every recommendation profile."
          icon={Shield}
          title="Explicit content"
        />
        <div
          className={cn(
            SETTINGS_SUBCARD_CLASS,
            "flex items-center justify-between gap-4 p-4"
          )}
        >
          <Label
            className="flex-1 flex-col items-start gap-0 leading-normal"
            htmlFor="network-show-explicit"
          >
            Show explicit content (18+)
            <span className="text-muted-foreground mt-1 block text-xs font-normal">
              Enable only if you’re 18 or older. Media warnings still appear
              before content is revealed.
            </span>
          </Label>
          <Switch
            checked={preferences.showExplicitContent}
            disabled={isSaving}
            id="network-show-explicit"
            onCheckedChange={(checked) =>
              save({ ...preferences, showExplicitContent: checked })
            }
          />
        </div>
      </SettingsCard>
      <SettingsCard className="space-y-4" id="settings-network-avoid">
        <SettingsCardHeading
          description="Hide matching topics and compound tags from Home, Gusts, and every recommendation profile."
          icon={Ban}
          title="Not interested"
        />
        <TopicPicker
          disabled={isSaving}
          label="Topic to avoid"
          limit={64}
          onToggle={(topic) =>
            save({
              ...preferences,
              avoidedTopics: preferences.avoidedTopics.includes(topic)
                ? preferences.avoidedTopics.filter((entry) => entry !== topic)
                : [...preferences.avoidedTopics, topic].slice(0, 64),
            })
          }
          selected={preferences.avoidedTopics}
        />
        <div aria-label="Avoided topics" className="flex flex-wrap gap-2">
          {preferences.avoidedTopics.map((topic) => (
            <button
              aria-label={`Stop avoiding ${topic}`}
              className="chip-3d inline-flex cursor-pointer items-center gap-1 rounded-full! px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={isSaving}
              key={topic}
              onClick={() =>
                save({
                  ...preferences,
                  avoidedTopics: preferences.avoidedTopics.filter(
                    (value) => value !== topic
                  ),
                })
              }
              type="button"
            >
              {topic} <X className="size-3" />
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Chosen exclusions stay until you remove them. A topic such as furry
          also hides furryart, furryimages, and similar tagged formats. Matching
          uses available text and topic metadata.
        </p>
        <div aria-live="polite" className="text-muted-foreground text-xs">
          {persona.avoidedTopics.length
            ? `Showing less based on mutes and downvotes in ${profile.name}: ${persona.avoidedTopics.join(", ")}.`
            : "Mutes, downvotes, and Not interested will teach this profile which topics to show less."}
          <p className="mt-2">
            Learned preferences fade over 30 days. Add a learned topic above to
            hide it explicitly.
          </p>
        </div>
      </SettingsCard>
    </>
  );
}
