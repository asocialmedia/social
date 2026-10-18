"use client";

import { ChevronRight, Globe, Languages, X } from "lucide-react";
import { useMemo, useState } from "react";

import { SettingsCard } from "@/components/settings/settings-section-card";

import { ContentLanguagesDialog } from "./content-languages-dialog";
import type { NetworkPanelProps } from "./panel-props";
import { RegionPicker } from "./region-picker";

function describeRegion(value: string, names: Intl.DisplayNames): string {
  if (value === "auto") {
    return "Device region";
  }
  if (value === "all") {
    return "No regional preference";
  }
  return names.of(value) ?? value;
}

// Two raised rows, one job each: which languages the feeds speak, and which
// region they lean toward. Both use the same self-colored edge and top-lit lip
// as every other settings row, with no drop shadow, so the panel reads as part
// of the app rather than a form bolted onto it.
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

  const languageSummary = useMemo(() => {
    if (selectedLanguages.length === 0) {
      return "All languages (none selected)";
    }
    const names = selectedLanguages.map(
      (code) => languageNames.of(code) ?? code
    );
    if (names.length <= 3) {
      return names.join(", ");
    }
    return `${names.slice(0, 2).join(", ")} + ${names.length - 2} more`;
  }, [selectedLanguages, languageNames]);

  const updateLanguages = (languages: string[]) =>
    save({
      ...preferences,
      contentLanguages: languages,
      language:
        languages.length === 0
          ? "all"
          : (languages[0] as typeof preferences.language),
    });

  return (
    <>
      <SettingsCard className="space-y-4" id="settings-network-region">
        {/* The heading uses the same 36px mark on the same axis as the two rows
            below it, so all three icons sit in one straight column. The shared
            SettingsCardHeading renders a 28px mark, which visibly stepped in
            from the rows and is the reason this header is built here. */}
        <div className="flex min-w-0 items-center gap-3 pl-3">
          <span className="orange-3d-surface flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-b from-[#ff9500] to-[#e65500] text-white">
            <Globe className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="font-medium">Geography and language</h3>
            <p className="text-muted-foreground text-sm">
              Prefer content in your languages and about your region.
            </p>
          </div>
        </div>

        {/* Two rows, one job each, as bare controls rather than boxes inside a
            box: the same filled 3D hover as the rest of the app paints the whole
            row, and the icon tiles line up on one axis with the text. */}
        <div className="flex flex-col gap-1">
          <button
            className="pill-3d-hover flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-50"
            disabled={isSaving}
            onClick={() => setDialogOpen(true)}
            type="button"
          >
            <span className="surface-3d flex size-9 shrink-0 items-center justify-center rounded-xl!">
              <Languages className="text-foreground size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                Content languages
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {languageSummary}
              </span>
            </span>
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs font-medium">
              {selectedLanguages.length === 0
                ? "All"
                : `${selectedLanguages.length} selected`}
              <ChevronRight className="size-4" />
            </span>
            {/* The visible row states the setting; this names the action the
                row performs, so a screen reader hears "Select content
                languages" rather than just the current summary. */}
            <span className="sr-only">Select content languages</span>
          </button>

          {selectedLanguages.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3 pb-1 pl-15">
              {selectedLanguages.map((code) => (
                // A chosen language. The pill is only as wide as its label at
                // rest; the cross is collapsed to zero width and revealed on
                // hover or focus, so the pill grows into it rather than
                // reserving a gap that reads as a missing icon. It stays in the
                // DOM and keyboard reachable, and is always shown on touch where
                // there is no hover.
                <span
                  className="chip-3d-raised group/pill inline-flex items-center rounded-lg py-1.5 pr-2.5 pl-3 text-sm font-medium transition-[padding] group-hover/pill:pr-1.5"
                  key={code}
                >
                  {languageNames.of(code) ?? code}
                  <button
                    aria-label={`Remove ${languageNames.of(code) ?? code}`}
                    className="focus-visible:ring-ring ml-0 flex w-0 items-center justify-center overflow-hidden rounded-md opacity-0 transition-all group-hover/pill:ml-1 group-hover/pill:w-5 group-hover/pill:opacity-100 focus-visible:ml-1 focus-visible:w-5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-40 max-md:ml-1 max-md:w-5 max-md:opacity-100"
                    disabled={isSaving}
                    onClick={() =>
                      updateLanguages(
                        selectedLanguages.filter((item) => item !== code)
                      )
                    }
                    type="button"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground px-3 pb-1 pl-15 text-xs">
              All languages are currently shown in your feeds.
            </p>
          )}

          <RegionPicker
            description="Local stories rank first when they exist."
            disabled={isSaving}
            icon={Globe}
            label="Regional content"
            onChange={(region) => save({ ...preferences, region })}
            options={regions}
            value={preferences.region}
            valueLabel={describeRegion(preferences.region, regionNames)}
          />
        </div>

        <p className="text-muted-foreground text-xs">
          Regional relevance is a preference, not a claim about where a person
          lives or publishes from. Feeds stay global when local candidates are
          unavailable.
        </p>
      </SettingsCard>

      <ContentLanguagesDialog
        onOpenChange={setDialogOpen}
        onSelectLanguages={updateLanguages}
        open={dialogOpen}
        selectedLanguages={selectedLanguages}
      />
    </>
  );
}
