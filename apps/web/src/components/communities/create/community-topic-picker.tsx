"use client";

import { COMMUNITY_LIMITS, COMMUNITY_TOPICS } from "@asm/db/communities";

import { cn } from "@/lib/utils";

// Multi-select topic chips. Topics are the discovery taxonomy: they file the
// community under the shelves on /communities. Styled as the same chips the
// discovery filter strip uses (rounded-lg, pill-nav-active when chosen) so the
// wizard and the page it feeds read as one control. Capped at topicMax.
export default function CommunityTopicPicker({
  onChange,
  selected,
}: {
  onChange: (topics: string[]) => void;
  selected: string[];
}) {
  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter((t) => t !== key));
      return;
    }
    if (selected.length >= COMMUNITY_LIMITS.topicMax) {
      return;
    }
    onChange([...selected, key]);
  };

  const atCap = selected.length >= COMMUNITY_LIMITS.topicMax;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        {COMMUNITY_TOPICS.map((topic) => {
          const isSelected = selected.includes(topic.key);
          const isDisabled = !isSelected && atCap;
          return (
            <button
              aria-pressed={isSelected}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ease-out",
                isSelected
                  ? "pill-nav-active"
                  : "pill-3d-hover text-muted-foreground hover:text-foreground border-transparent",
                isDisabled && "cursor-not-allowed opacity-40"
              )}
              disabled={isDisabled}
              key={topic.key}
              onClick={() => toggle(topic.key)}
              type="button"
            >
              {topic.label}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs tabular-nums">
        {selected.length}/{COMMUNITY_LIMITS.topicMax} selected
      </p>
    </div>
  );
}
