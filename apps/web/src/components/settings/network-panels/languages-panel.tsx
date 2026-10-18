"use client";

import { NETWORK_LANGUAGES } from "@asm/protocols/discovery";
import { Label } from "@asm/ui/shadui/label";
import { Globe } from "lucide-react";
import { useMemo } from "react";

import {
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";

import type { NetworkPanelProps } from "./panel-props";

export default function LanguagesPanel({
  isSaving,
  preferences,
  save,
}: NetworkPanelProps) {
  const languageNames = useMemo(
    () => new Intl.DisplayNames(["en"], { type: "language" }),
    []
  );
  const regionNames = useMemo(
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
        .map((code) => ({ code, name: regionNames.of(code) ?? code }))
        .filter(({ code, name }) => code !== name && code !== "ZZ")
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [regionNames]
  );
  return (
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
                {languageNames.of(language) ?? language}
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
  );
}
