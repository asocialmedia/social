"use client";

import { Button } from "@asm/ui/shadui/button";
import { ArrowLeft, ChevronRight, Network } from "lucide-react";
import type { ComponentType } from "react";

import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { cn } from "@/lib/utils";

import ContentPanel from "./network-panels/content-panel";
import LanguagesPanel from "./network-panels/languages-panel";
import ModerationPanel from "./network-panels/moderation-panel";
import type { NetworkPanelProps } from "./network-panels/panel-props";
import ProfilesPanel from "./network-panels/profiles-panel";
import {
  NETWORK_SUBPAGES,
  networkSubpageEntry,
  networkSubpageSummary,
} from "./network-subpages";
import type { NetworkSubpage } from "./network-subpages";
import SettingsFooterArt from "./settings-footer-art";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "./settings-section-card";

// The settings shell owns the scroll container, so a subpage has to ask it to
// return to the top; otherwise it opens at the hub's previous scroll offset.
function revealTop() {
  document
    .querySelector<HTMLElement>("[data-settings-scroll]")
    ?.scrollTo({ behavior: "auto", top: 0 });
}

const PANELS: Record<NetworkSubpage, ComponentType<NetworkPanelProps>> = {
  content: ContentPanel,
  languages: LanguagesPanel,
  moderation: ModerationPanel,
  profiles: ProfilesPanel,
};

interface NetworkSettingsProps {
  onOpenSection: (section: NetworkSubpage | null) => void;
  section: NetworkSubpage | null;
}

export default function NetworkSettings({
  onOpenSection,
  section,
}: NetworkSettingsProps) {
  const { settings, save, ready, isSaving, error, refetch } =
    useNetworkSettings();
  const { catalog, persona, preferences } = settings;
  const profile =
    preferences.profiles.find(
      (entry) => entry.id === preferences.activeProfileId
    ) ?? preferences.profiles[0];
  const openSubpage = (next: NetworkSubpage | null) => {
    onOpenSection(next);
    revealTop();
  };
  // The section header, and therefore the way back to the hub, must not depend
  // on preferences having arrived: a slow or failed load used to leave the
  // reader stranded on a section page with no exit.
  const sectionEntry = section ? networkSubpageEntry(section) : null;
  const sectionHeader = sectionEntry ? (
    <div className="flex items-center gap-3">
      <button
        aria-label="Back to network settings"
        className="icon-btn-3d flex size-10 shrink-0 items-center justify-center rounded-full transition-all! duration-300! ease-out! hover:scale-105 active:scale-95"
        onClick={() => openSubpage(null)}
        type="button"
      >
        <ArrowLeft className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <SettingsSectionHeader
          description={sectionEntry.description}
          icon={sectionEntry.icon}
          title={sectionEntry.title}
        />
      </div>
    </div>
  ) : null;
  if (!ready || !profile) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
        {sectionHeader}
        <div className="flex flex-col items-start gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            Loading network preferences…
          </p>
          {error ? (
            <Button
              onClick={() => {
                void refetch();
              }}
              variant="premium"
            >
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  if (!section) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
        {/* The header sits at the container edge while a row's mark sits inset by
            the card border (1px) plus the card padding (6px) plus the row
            padding (12px). Matching that 19px inset here lines the header mark
            up with the row marks below it. */}
        <div className="pl-[19px]">
          <SettingsSectionHeader
            description="Shape discovery across your networks"
            icon={Network}
            title="Network"
          />
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error.message}
          </p>
        ) : null}
        <SettingsCard className="p-1.5!" id="settings-network">
          <div className="flex flex-col gap-0.5">
            {NETWORK_SUBPAGES.map((entry) => (
              <button
                className="pill-3d-hover group flex w-full items-center gap-3 rounded-xl border-0 px-3 py-3 text-left"
                key={entry.id}
                onClick={() => openSubpage(entry.id)}
                type="button"
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    ORANGE_GRADIENT_CLASS
                  )}
                >
                  <entry.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {entry.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs font-normal transition-colors group-hover:text-inherit">
                    {entry.description}
                  </span>
                  <span className="text-muted-foreground mt-1.5 block text-xs font-medium tabular-nums transition-colors group-hover:text-inherit">
                    {networkSubpageSummary(entry.id, preferences, profile.name)}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0" />
              </button>
            ))}
          </div>
        </SettingsCard>
        <p aria-live="polite" className="sr-only">
          {isSaving ? "Saving network preferences…" : ""}
        </p>
        <SettingsFooterArt className="-mx-4 mt-auto sm:-mx-6" tab="network" />
      </div>
    );
  }
  const Panel = PANELS[section];
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
      {sectionHeader}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error.message}
        </p>
      ) : null}
      <Panel
        catalog={catalog}
        isSaving={isSaving}
        persona={persona}
        preferences={preferences}
        profile={profile}
        save={save}
      />
      <p aria-live="polite" className="sr-only">
        {isSaving ? "Saving network preferences…" : ""}
      </p>
      <SettingsFooterArt className="-mx-4 mt-auto sm:-mx-6" tab="network" />
    </div>
  );
}
