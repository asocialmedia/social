"use client";

import { COMMUNITY_LIMITS, COMMUNITY_TOPICS } from "@asm/db/communities";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// Multi-select topic grid. Topics are the discovery taxonomy: they file the
// community under the rails on /comm. Capped at COMMUNITY_LIMITS.topicMax.
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

  return (
    <div className="flex flex-col gap-2">
      <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
        {COMMUNITY_TOPICS.map((topic) => {
          const isSelected = selected.includes(topic.key);
          const atCap =
            !isSelected && selected.length >= COMMUNITY_LIMITS.topicMax;
          return (
            <button
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                isSelected
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/60 hover:bg-muted/50 text-muted-foreground",
                atCap && "cursor-not-allowed opacity-50"
              )}
              disabled={atCap}
              key={topic.key}
              onClick={() => toggle(topic.key)}
              type="button"
            >
              <span aria-hidden="true" className="text-base leading-none">
                {topic.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate">{topic.label}</span>
              {isSelected ? (
                <Check className="text-primary size-4 shrink-0" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        {selected.length}/{COMMUNITY_LIMITS.topicMax} selected. Topics help
        people find your community.
      </p>
    </div>
  );
}
