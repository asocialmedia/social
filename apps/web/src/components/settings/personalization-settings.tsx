"use client";

import { Label } from "@asm/ui/shadui/label";
import { RadioGroup, RadioGroupItem } from "@asm/ui/shadui/radio-group";
import { Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import SettingsFooterArt from "./settings-footer-art";
import {
  SettingsCard,
  SettingsCardHeading,
  SettingsSectionHeader,
} from "./settings-section-card";

const OPTIONS = [
  {
    description: "Bright surfaces with soft shadows.",
    label: "Light",
    value: "light",
  },
  {
    description: "Dim surfaces for a darker appearance.",
    label: "Dark",
    value: "dark",
  },
  {
    description: "Follow your device's light or dark appearance.",
    label: "System",
    value: "system",
  },
] as const;
const subscribe = () => () => {
  /* empty */
};

export default function PersonalizationSettings() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
      <SettingsSectionHeader
        icon={Palette}
        title="Personalization"
        description="Make asocialmedia feel like yours"
      />
      <SettingsCard id="settings-appearance" className="space-y-5">
        <SettingsCardHeading
          icon={Palette}
          title="Appearance"
          description="Saved in this browser. Changes apply across the app."
        />
        <RadioGroup
          aria-label="Appearance"
          value={mounted ? theme : ""}
          onValueChange={setTheme}
          className="gap-3"
        >
          {OPTIONS.map((option) => (
            <Label
              key={option.value}
              htmlFor={`appearance-${option.value}`}
              className="settings-choice surface-3d flex cursor-pointer items-start gap-3 rounded-xl! p-4"
              data-selected={mounted && theme === option.value}
            >
              <RadioGroupItem
                aria-label={option.label}
                id={`appearance-${option.value}`}
                value={option.value}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {option.label}
                </span>
                <span className="text-muted-foreground mt-1 block text-sm font-normal">
                  {option.description}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </SettingsCard>
      <SettingsFooterArt
        className="-mx-4 mt-auto sm:-mx-6"
        tab="personalization"
      />
    </div>
  );
}
