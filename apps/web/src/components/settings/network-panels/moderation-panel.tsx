"use client";

import { Label } from "@asm/ui/shadui/label";
import { Switch } from "@asm/ui/shadui/switch";
import { Shield, Sparkles } from "lucide-react";

import type { NetworkPanelProps } from "./panel-props";
import { SettingsPanelSection } from "./settings-panel-section";
import { SettingsPill } from "./settings-pill";
import { TopicPicker } from "./topic-picker";

export default function ModerationPanel({
  isSaving,
  persona,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const avoided = preferences.avoidedTopics;
  return (
    <>
      <SettingsPanelSection
        description="Media warnings still appear before content is revealed."
        icon={Shield}
        id="settings-network-explicit"
        title="Explicit content"
      >
        <div className="flex items-center justify-between gap-4 px-3">
          <Label
            className="flex-1 flex-col items-start gap-0 leading-normal"
            htmlFor="network-show-explicit"
          >
            Show explicit content (18+)
            <span className="text-muted-foreground mt-1 block text-xs font-normal">
              Enable only if you’re 18 or older. Off by default, and applies to
              Home, Explore, Gusts, and every profile.
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
      </SettingsPanelSection>

      <SettingsPanelSection
        count={avoided.length ? `${avoided.length} of 64` : undefined}
        description="Hide matching topics and compound tags from every feed."
        icon={Sparkles}
        id="settings-network-avoid"
        title="Not interested"
      >
        <div className="space-y-4 px-3">
          <TopicPicker
            disabled={isSaving}
            label="Topic to avoid"
            limit={64}
            onToggle={(topic) =>
              save({
                ...preferences,
                avoidedTopics: avoided.includes(topic)
                  ? avoided.filter((entry) => entry !== topic)
                  : [...avoided, topic].slice(0, 64),
              })
            }
            selected={avoided}
          />

          {avoided.length ? (
            <div aria-label="Avoided topics" className="flex flex-wrap gap-2">
              {avoided.map((topic) => (
                <SettingsPill
                  disabled={isSaving}
                  key={topic}
                  label={topic}
                  onRemove={() =>
                    save({
                      ...preferences,
                      avoidedTopics: avoided.filter((value) => value !== topic),
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Nothing hidden yet. A topic such as furry also hides furryart and
              similar tagged formats.
            </p>
          )}

          <div
            aria-live="polite"
            className="text-muted-foreground border-border/60 space-y-2 border-t pt-3 text-xs"
          >
            {persona.avoidedTopics.length ? (
              <p>
                Showing less in {profile.name} from mutes and downvotes:{" "}
                {persona.avoidedTopics.join(", ")}.
              </p>
            ) : (
              <p>
                Mutes, downvotes, and Not interested teach this profile what to
                show less of.
              </p>
            )}
            <p>
              Learned preferences fade over 30 days. Add a learned topic above
              to hide it explicitly.
            </p>
          </div>
        </div>
      </SettingsPanelSection>
    </>
  );
}
