"use client";

import { interestSchema, NETWORK_LANGUAGES } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Label } from "@asm/ui/shadui/label";
import { Switch } from "@asm/ui/shadui/switch";
import {
  Ban,
  X,
  Brain,
  Check,
  Globe,
  Network,
  Plus,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { cn } from "@/lib/utils";

import {
  SettingsCard,
  SettingsCardHeading,
  SettingsSectionHeader,
} from "./settings-section-card";

export default function NetworkSettings() {
  const { settings, save, ready, isSaving, error } = useNetworkSettings();
  const [search, setSearch] = useState("");
  const [avoidSearch, setAvoidSearch] = useState("");
  const [profileName, setProfileName] = useState("");
  const { preferences, persona, catalog } = settings;
  const selected =
    preferences.profiles.find(
      (profile) => profile.id === preferences.activeProfileId
    ) ?? preferences.profiles[0];
  const names = useMemo(
    () => new Intl.DisplayNames(["en"], { type: "region" }),
    []
  );
  const regions = useMemo(
    () =>
      Array.from(
        { length: 676 },
        (_, index) =>
          `${String.fromCodePoint(65 + Math.floor(index / 26))}${String.fromCodePoint(65 + (index % 26))}`
      )
        .map((code) => ({ code, name: names.of(code) ?? code }))
        .filter(({ code, name }) => code !== name && code !== "ZZ")
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [names]
  );
  if (!ready || !selected) {
    return (
      <div className="p-6">
        <p aria-live="polite">Loading network preferences…</p>
        {error ? (
          <Button
            onClick={() => {
              /* empty */
            }}
          >
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  const updateInterests = (interests: string[]) =>
    save({
      ...preferences,
      profiles: preferences.profiles.map((profile) =>
        profile.id === selected.id ? { ...profile, interests } : profile
      ),
    });
  const toggleInterest = (topic: string) => {
    const parsed = interestSchema.safeParse(topic);
    if (!parsed.success) {
      return;
    }
    updateInterests(
      selected.interests.includes(parsed.data)
        ? selected.interests.filter((interest) => interest !== parsed.data)
        : [...selected.interests, parsed.data].slice(0, 32)
    );
  };
  const choices = [...new Set([...selected.interests, ...catalog])].filter(
    (topic) => topic.toLowerCase().includes(search.toLowerCase())
  );
  const custom = interestSchema.safeParse(search);
  return (
    <div className="flex flex-col gap-6 px-4 pt-6 sm:px-6">
      <SettingsSectionHeader
        description="Shape discovery across your networks"
        icon={Network}
        title="Network"
      />
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error.message}
        </p>
      ) : null}
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
          {preferences.profiles.map((profile) => (
            <Button
              aria-pressed={profile.id === selected.id}
              disabled={isSaving}
              key={profile.id}
              onClick={() =>
                save({ ...preferences, activeProfileId: profile.id })
              }
              size="sm"
              variant={profile.id === selected.id ? "premium" : "outline"}
            >
              {profile.id === selected.id ? (
                <Check className="size-3.5" />
              ) : null}
              {profile.name}
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
            const profile = {
              id: crypto.randomUUID(),
              interests: [],
              name: profileName.trim(),
            };
            save({
              ...preferences,
              activeProfileId: profile.id,
              profiles: [...preferences.profiles, profile],
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
              isSaving ||
              !profileName.trim() ||
              preferences.profiles.length >= 8
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
                (profile) => profile.id !== selected.id
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
            Delete {selected.name}
          </Button>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Chosen interests stay. Recent activity fades over 30 days. Switch
          profiles from Home’s feed settings.
        </p>
      </SettingsCard>
      <SettingsCard className="space-y-4" id="settings-network-interests">
        <SettingsCardHeading
          description={`Choose interests for ${selected.name}. Add any topic; these suggestions are a starting point.`}
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
              aria-pressed={selected.interests.includes(topic)}
              className={cn(
                "chip-3d focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-full! px-3 py-1.5 text-sm focus-visible:ring-2 disabled:opacity-50",
                selected.interests.includes(topic) && "text-primary"
              )}
              disabled={
                isSaving ||
                (!selected.interests.includes(topic) &&
                  selected.interests.length >= 32)
              }
              key={topic}
              onClick={() => toggleInterest(topic)}
              type="button"
            >
              {selected.interests.includes(topic) ? (
                <Check className="size-3" />
              ) : null}
              {topic}
            </button>
          ))}
        </div>
        {custom.success &&
        !catalog.includes(custom.data) &&
        !selected.interests.includes(custom.data) ? (
          <Button
            disabled={isSaving || selected.interests.length >= 32}
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
            {selected.interests.length}/32 chosen · {persona.signalCount} recent
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
              Related interests discovered:{" "}
              {persona.relatedInterests.join(", ")}
            </p>
          ) : null}
        </div>
      </SettingsCard>
      <SettingsCard className="space-y-4" id="settings-network-avoid">
        <SettingsCardHeading
          description="Hide matching topics from all your Home feeds and recommendation profiles."
          icon={Ban}
          title="Avoid topics"
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
            placeholder="Add a topic, e.g. furry…"
            value={avoidSearch}
            onChange={(event) => setAvoidSearch(event.target.value)}
          />
          <Button
            type="submit"
            variant="premium"
            disabled={
              isSaving ||
              !interestSchema.safeParse(avoidSearch).success ||
              preferences.avoidedTopics.length >= 64
            }
          >
            <Plus className="size-4" /> Add
          </Button>
        </form>
        <div aria-label="Avoided topics" className="flex flex-wrap gap-2">
          {preferences.avoidedTopics.map((topic) => (
            <button
              type="button"
              key={topic}
              disabled={isSaving}
              aria-label={`Stop avoiding ${topic}`}
              className="chip-3d inline-flex cursor-pointer items-center gap-1 rounded-full! px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() =>
                save({
                  ...preferences,
                  avoidedTopics: preferences.avoidedTopics.filter(
                    (value) => value !== topic
                  ),
                })
              }
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
            ? `Showing less based on mutes and downvotes in ${selected.name}: ${persona.avoidedTopics.join(", ")}.`
            : "Mutes, downvotes, and Not interested will teach this profile which topics to show less."}
          <p className="mt-2">
            Learned preferences fade over 30 days. Add a learned topic above to
            hide it explicitly.
          </p>
        </div>
      </SettingsCard>
      <SettingsCard className="space-y-4" id="settings-network-explicit">
        <SettingsCardHeading
          description="Applies to every recommendation profile and Home feed."
          icon={Shield}
          title="Explicit content"
        />
        <div className="flex items-center justify-between gap-4">
          <Label className="flex-1" htmlFor="network-show-explicit">
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
      <SettingsCard className="space-y-4" id="settings-network-region">
        <SettingsCardHeading
          description="Prefer content in your languages and about your region."
          icon={Globe}
          title="Geography and language"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="network-language">Content language</Label>
            <select
              className="premium-input w-full px-3 py-2 text-sm"
              disabled={isSaving}
              id="network-language"
              onChange={(event) => {
                const language = event.target.value;
                if (
                  language === "auto" ||
                  language === "all" ||
                  NETWORK_LANGUAGES.some((value) => value === language)
                ) {
                  save({
                    ...preferences,
                    language: language as typeof preferences.language,
                  });
                }
              }}
              value={preferences.language}
            >
              <option value="auto">Device language</option>
              <option value="all">All languages</option>
              {NETWORK_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {new Intl.DisplayNames(["en"], { type: "language" }).of(
                    language
                  )}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="network-region">Regional content</Label>
            <select
              className="premium-input w-full px-3 py-2 text-sm"
              disabled={isSaving}
              id="network-region"
              onChange={(event) =>
                save({ ...preferences, region: event.target.value })
              }
              value={preferences.region}
            >
              <option value="auto">Device region</option>
              <option value="all">No regional preference</option>
              {regions.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Regional relevance is a preference, not a claim about where a person
          lives.
        </p>
      </SettingsCard>
      <p aria-live="polite" className="text-muted-foreground pb-4 text-xs">
        {isSaving
          ? "Saving…"
          : "Changes save automatically across your account."}
      </p>
    </div>
  );
}
