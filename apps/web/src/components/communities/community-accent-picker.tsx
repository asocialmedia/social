"use client";

import { COMMUNITY_ACCENTS } from "@asm/db/communities";
import type { CommunityAccent } from "@asm/db/communities";
import { Check } from "lucide-react";

import { communityAccentStyle } from "@/lib/communities/accent";
import { cn } from "@/lib/utils";

// Accent swatches. Each key maps to a deep tone for light mode and a lifted one
// for dark, both held in @asm/db so the wizard, the rail and the header read the
// same source. A swatch fills with the theme-appropriate value and shows the
// key's label, never a raw hex field.
export default function CommunityAccentPicker({
  onChange,
  value,
}: {
  onChange: (key: string) => void;
  value: string;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {COMMUNITY_ACCENTS.map((accent: CommunityAccent) => {
        const isSelected = accent.key === value;
        return (
          <button
            aria-label={accent.label}
            aria-pressed={isSelected}
            className={cn(
              "group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
              isSelected
                ? "border-primary/60 bg-primary/5"
                : "border-border/60 hover:bg-muted/50"
            )}
            key={accent.key}
            onClick={() => onChange(accent.key)}
            type="button"
          >
            <span
              className="flex size-8 items-center justify-center rounded-full bg-[var(--community-accent)] dark:bg-[var(--community-accent-dark)]"
              style={communityAccentStyle(accent.key)}
            >
              {isSelected ? (
                <Check
                  className="size-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]"
                  strokeWidth={3}
                />
              ) : null}
            </span>
            <span className="text-muted-foreground truncate text-[11px]">
              {accent.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
