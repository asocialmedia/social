"use client";

import type { FeedSource } from "@asm/protocols/discovery";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Check, Globe, Settings2, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback } from "react";

import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { cn } from "@/lib/utils";
import { useFeedSourceStore } from "@/store/feed-source-store";

interface SourceOption {
  value: FeedSource;
  label: string;
  icon: React.ReactNode;
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    icon: <Globe className="size-3.5" />,
    label: "All Networks",
    value: "all",
  },
  {
    icon: <Sparkles className="size-3.5 text-[#ff9500]!!" />,
    label: "asocialmedia",
    value: "asm",
  },
  {
    icon: <BlueskyIcon className="size-3.5" tooltip={false} />,
    label: "Bluesky",
    value: "bluesky",
  },
];

const LANGUAGE_OPTIONS = [
  { label: "Device", value: "auto" },
  { label: "English", value: "en" },
  { label: "All", value: "all" },
] as const;

function getLanguageLabel(language: string): string {
  if (language === "auto") {
    return "Device";
  }
  if (language === "en") {
    return "English";
  }
  return "All";
}

export function FeedSourceMenu({ following }: { following: boolean }) {
  const source = useFeedSourceStore((state) => state.source);
  const setSource = useFeedSourceStore((state) => state.setSource);
  const language = useFeedSourceStore((state) => state.language);
  const setLanguage = useFeedSourceStore((state) => state.setLanguage);

  const activeSource = following ? "asm" : source;
  const isCustomized = !following && (source !== "all" || language !== "auto");

  const handleReset = useCallback(() => {
    setSource("all");
    setLanguage("auto");
  }, [setSource, setLanguage]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Feed settings (${following ? "asocialmedia" : activeSource})`}
          className={cn(
            "group relative mx-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors active:translate-y-px",
            // Squaricle 3D border background supporting dark and light
            "border border-border/80 bg-secondary/60 hover:bg-secondary",
            "shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.05)]",
            "dark:border-white/15 dark:bg-muted/40 dark:hover:bg-muted/70",
            "dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),inset_0_-1px_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.25)]",
            "text-muted-foreground hover:text-foreground"
          )}
          type="button"
        >
          <Settings2 className="size-4.5" />
          {isCustomized ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[#ff9500]" />
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 p-1.5" sideOffset={6}>
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold text-foreground">
            Feed Settings
          </span>
          {isCustomized ? (
            <button
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onClick={handleReset}
              type="button"
            >
              Reset
            </button>
          ) : null}
        </div>

        <div className="my-1 h-px bg-border/60" />

        {/* Source Items */}
        <div className="space-y-0.5">
          {SOURCE_OPTIONS.map((opt) => {
            const isSelected = activeSource === opt.value;
            return (
              <button
                key={opt.value}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer text-left",
                  isSelected
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  following && "opacity-50 cursor-not-allowed hover:bg-transparent"
                )}
                disabled={following}
                onClick={() => {
                  if (!following) {
                    setSource(opt.value);
                  }
                }}
                type="button"
              >
                <span className="flex items-center gap-2">
                  {opt.icon}
                  <span>{opt.label}</span>
                </span>
                {isSelected ? (
                  <Check className="size-3.5 text-[#ff9500]" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="my-1 h-px bg-border/60" />

        {/* Language Section */}
        <div className="px-1 pt-1 pb-0.5">
          <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
            <span>Language</span>
            <span className="text-[10px] text-muted-foreground/75">
              {getLanguageLabel(language)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-0.5">
            {LANGUAGE_OPTIONS.map((lang) => {
              const isLangSelected = language === lang.value;
              return (
                <button
                  key={lang.value}
                  aria-pressed={isLangSelected}
                  className={cn(
                    "rounded-md py-1 text-[11px] font-medium transition-colors cursor-pointer text-center",
                    isLangSelected
                      ? "bg-background text-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setLanguage(lang.value)}
                  type="button"
                >
                  {lang.label}
                </button>
              );
            })}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
