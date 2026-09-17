"use client";

import { COMMUNITY_ACCENTS } from "@asm/db/communities";
import type { CommunityAccent } from "@asm/db/communities";

import { communityAccentStyle } from "@/lib/communities/accent";
import { cn } from "@/lib/utils";

// Accent chips. Each key maps to a deep tone for light mode and a lifted one for
// dark, both held in @asm/db so the wizard, the rail and the post card read the
// same source. The dot carries the swatch; the chip follows the same chip
// language as the topic picker so the two steps feel like one control.
export default function CommunityAccentPicker({
  onChange,
  value,
}: {
  onChange: (key: string) => void;
  value: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COMMUNITY_ACCENTS.map((accent: CommunityAccent) => {
        const isSelected = accent.key === value;
        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ease-out",
              isSelected
                ? "pill-nav-active"
                : "pill-3d-hover text-muted-foreground hover:text-foreground border-transparent"
            )}
            key={accent.key}
            onClick={() => onChange(accent.key)}
            style={communityAccentStyle(accent.key)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="size-3.5 shrink-0 rounded-[5px] bg-[var(--community-accent)] dark:bg-[var(--community-accent-dark)]"
            />
            {accent.label}
          </button>
        );
      })}
    </div>
  );
}
