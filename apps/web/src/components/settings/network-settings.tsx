"use client";

import { Button } from "@asm/ui/shadui/button";
import { ChevronLeft, ChevronRight, Network } from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useSyncExternalStore } from "react";

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
  readRequestedNetworkSubpage,
  requestNetworkSubpage,
  subscribeNetworkSubpage,
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

export default function NetworkSettings() {
  const { settings, save, ready, isSaving, error, refetch } =
    useNetworkSettings();
  const subpage = useSyncExternalStore(
    subscribeNetworkSubpage,
    readRequestedNetworkSubpage,
    readRequestedNetworkSubpage
  );
  const { catalog, persona, preferences } = settings;
  const profile =
    preferences.profiles.find(
      (entry) => entry.id === preferences.activeProfileId
    ) ?? preferences.profiles[0];
  const openSubpage = useCallback((next: NetworkSubpage | null) => {
    requestNetworkSubpage(next);
    revealTop();
  }, []);
  if (!ready || !profile) {
    return (
      <div className="p-6">
        <p aria-live="polite">Loading network preferences…</p>
        {error ? (
          <Button
            onClick={() => {
              void refetch();
            }}
          >
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  if (!subpage) {
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
        <SettingsFooterArt
          className="-mx-4 mt-auto pt-6 sm:-mx-6"
          tab="network"
        />
        <p aria-live="polite" className="sr-only">
          {isSaving ? "Saving network preferences…" : ""}
        </p>
      </div>
    );
  }
  const panel = networkSubpageEntry(subpage);
  const Panel = PANELS[subpage];
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <button
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded-lg text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
          onClick={() => openSubpage(null)}
          type="button"
        >
          <ChevronLeft className="size-3.5" />
          All network settings
        </button>
        <SettingsSectionHeader
          description={panel.description}
          icon={panel.icon}
          title={panel.title}
        />
      </div>
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
      <SettingsFooterArt
        className="-mx-4 mt-auto pt-6 sm:-mx-6"
        tab="network"
      />
      <p aria-live="polite" className="sr-only">
        {isSaving ? "Saving network preferences…" : ""}
      </p>
    </div>
  );
}
