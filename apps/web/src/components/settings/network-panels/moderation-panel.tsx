"use client";

import { interestSchema } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Label } from "@asm/ui/shadui/label";
import { Switch } from "@asm/ui/shadui/switch";
import { Ban, Plus, Shield, X } from "lucide-react";
import { useState } from "react";

import {
  SETTINGS_SUBCARD_CLASS,
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";
import { cn } from "@/lib/utils";

import type { NetworkPanelProps } from "./panel-props";

export default function ModerationPanel({
  isSaving,
  persona,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const [avoidSearch, setAvoidSearch] = useState("");
  return (
    <>
      <SettingsCard className="space-y-4" id="settings-network-explicit">
        <SettingsCardHeading
          description="Applies to every recommendation profile and Home feed."
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
          description="Hide matching topics from all your Home feeds and recommendation profiles."
          icon={Ban}
          title="Not interested"
        />
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const topic = interestSchema.safeParse(avoidSearch);
            if (
              !topic.success ||
              preferences.avoidedTopics.includes(topic.data) ||
              preferences.avoidedTopics.length >= 64
            ) {
              return;
            }
            save({
              ...preferences,
              avoidedTopics: [...preferences.avoidedTopics, topic.data],
            });
            setAvoidSearch("");
          }}
        >
          <Input
            aria-label="Topic to avoid"
            maxLength={64}
            onChange={(event) => setAvoidSearch(event.target.value)}
            placeholder="Add a topic, e.g. furry…"
            value={avoidSearch}
          />
          <Button
            disabled={
              isSaving ||
              !interestSchema.safeParse(avoidSearch).success ||
              preferences.avoidedTopics.length >= 64
            }
            type="submit"
            variant="premium"
          >
            <Plus className="size-4" /> Add
          </Button>
        </form>
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
          Chosen exclusions stay until you remove them. Matching uses available
          text and topic metadata.
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
