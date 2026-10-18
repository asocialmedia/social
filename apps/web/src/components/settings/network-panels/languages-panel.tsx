"use client";

import { Label } from "@asm/ui/shadui/label";
import { ChevronRight, Globe, Languages, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  SETTINGS_SUBCARD_CLASS,
  SettingsCard,
  SettingsCardHeading,
} from "@/components/settings/settings-section-card";
import { cn } from "@/lib/utils";

import { ContentLanguagesDialog } from "./content-languages-dialog";
import type { NetworkPanelProps } from "./panel-props";

export default function LanguagesPanel({
  isSaving,
  preferences,
  save,
}: NetworkPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const languageNames = useMemo(
    () => new Intl.DisplayNames(["en"], { type: "language" }),
    []
  );
  const regionNames = useMemo(
    () => new Intl.DisplayNames(["en"], { type: "region" }),
    []
  );

  const selectedLanguages = useMemo(() => {
    if (preferences.contentLanguages !== undefined) {
      return preferences.contentLanguages;
    }
    if (preferences.language === "all") {
      return [];
    }
    if (preferences.language !== "auto" && preferences.language !== "en") {
      return ["en", preferences.language];
    }
    return ["en"];
  }, [preferences.contentLanguages, preferences.language]);

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

  const handleUpdateLanguages = (languages: string[]) => {
    save({
      ...preferences,
      contentLanguages: languages,
      language:
        languages.length === 0
          ? "all"
          : (languages[0] as typeof preferences.language),
    });
  };

  const removeLanguage = (code: string) => {
    const next = selectedLanguages.filter((item) => item !== code);
    handleUpdateLanguages(next);
  };

  const describeCode = useCallback(
    (code: string) => {
      try {
        return languageNames.of(code) ?? code;
      } catch {
        return code;
      }
    },
    [languageNames]
  );

  const languageSummary = useMemo(() => {
    if (selectedLanguages.length === 0) {
      return "All languages (none selected)";
    }
    if (selectedLanguages.length <= 3) {
      return selectedLanguages.map(describeCode).join(", ");
    }
    return `${selectedLanguages.slice(0, 2).map(describeCode).join(", ")} + ${selectedLanguages.length - 2} more`;
  }, [selectedLanguages, describeCode]);

  return (
    <>
      <SettingsCard className="space-y-4" id="settings-network-region">
        <SettingsCardHeading
          description="Prefer content in your languages and about your region."
          icon={Globe}
          title="Geography and language"
        />

        <div className="space-y-3">
          <Label className="text-foreground text-sm font-medium">
            Content languages
          </Label>

          <button
            className={cn(
              SETTINGS_SUBCARD_CLASS,
              "hover:border-primary/40 group flex w-full cursor-pointer items-center justify-between gap-3 p-3.5 text-left transition-all"
            )}
            disabled={isSaving}
            onClick={() => setDialogOpen(true)}
            type="button"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="surface-3d text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
                <Languages className="size-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-semibold">
                  Select content languages
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {languageSummary}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="chip-3d text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold">
                {selectedLanguages.length === 0
                  ? "All"
                  : `${selectedLanguages.length} selected`}
              </span>
              <ChevronRight className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
            </div>
          </button>

          {/* Chips for currently selected languages */}
          {selectedLanguages.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {selectedLanguages.map((code) => (
                <span
                  key={code}
                  className="chip-3d text-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                >
                  {describeCode(code)}
                  <button
                    aria-label={`Remove ${describeCode(code)}`}
                    className="text-muted-foreground hover:text-foreground ml-0.5 cursor-pointer rounded-full p-0.5 transition-colors"
                    disabled={isSaving}
                    onClick={() => removeLanguage(code)}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs italic">
              All languages are currently shown in your feeds.
            </p>
          )}
        </div>

        <div className="space-y-2 pt-2">
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

        <p className="text-muted-foreground text-xs">
          Regional relevance is a preference, not a claim about where a person
          lives or publishes from. Feeds remain global when local candidates are
          unavailable.
        </p>
      </SettingsCard>

      <ContentLanguagesDialog
        onOpenChange={setDialogOpen}
        onSelectLanguages={handleUpdateLanguages}
        open={dialogOpen}
        selectedLanguages={selectedLanguages}
      />
    </>
  );
}
