"use client";

import type { FeedSource } from "@asm/protocols/discovery";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  Check,
  Globe,
  Info,
  Languages,
  RotateCcw,
  Settings2,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { useCallback, useSyncExternalStore } from "react";

import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { cn } from "@/lib/utils";
import { useFeedSourceStore } from "@/store/feed-source-store";

interface SourceOption {
  value: FeedSource;
  label: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    description: "Unified asocialmedia & Bluesky feed",
    icon: <Globe className="size-4 text-emerald-400" />,
    iconBg: "bg-emerald-500/10 border-emerald-500/25",
    label: "All Networks",
    value: "all",
  },
  {
    description: "Native local community & posts only",
    icon: <Sparkles className="size-4 text-[#ff9500]" />,
    iconBg: "bg-orange-500/10 border-orange-500/25",
    label: "asocialmedia",
    value: "asm",
  },
  {
    description: "Public AT Protocol discovery bridge",
    icon: <BlueskyIcon className="size-4" tooltip={false} />,
    iconBg: "bg-sky-500/10 border-sky-500/25",
    label: "Bluesky Network",
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
    return "Device Locale";
  }
  if (language === "en") {
    return "English Only";
  }
  return "All Languages";
}

const subscribe = () => () => {
  /* empty */
};

function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}

export function FeedSourceMenu({ following }: { following: boolean }) {
  const mounted = useMounted();
  const source = useFeedSourceStore((state) => state.source);
  const setSource = useFeedSourceStore((state) => state.setSource);
  const language = useFeedSourceStore((state) => state.language);
  const setLanguage = useFeedSourceStore((state) => state.setLanguage);

  // During SSR and initial hydration, align to the default store state to avoid
  // hydration mismatches when local storage contains persisted user choices.
  let activeSource: FeedSource = "all";
  if (following) {
    activeSource = "asm";
  } else if (mounted) {
    activeSource = source;
  }

  const activeLanguage = mounted ? language : "auto";
  const isCustomized =
    mounted && !following && (source !== "all" || language !== "auto");

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
            "group relative mx-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-all duration-200 active:translate-y-px",
            // Squaricle 3D dual-border background
            "border border-white/20 bg-linear-to-b from-white/10 to-white/5 backdrop-blur-md",
            "shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),inset_0_-1px_1px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.3)]",
            "hover:scale-[1.03] hover:border-white/35 hover:from-white/15 hover:to-white/10 hover:shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.45),0_4px_12px_rgba(0,0,0,0.4)]",
            "active:scale-[0.97]",
            "text-zinc-300 hover:text-white"
          )}
          suppressHydrationWarning
          type="button"
        >
          <Settings2 className="size-4.5 transition-transform duration-300 group-hover:rotate-45" />
          {isCustomized ? (
            <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff9500] opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full border-2 border-zinc-950 bg-[#ff9500] shadow-[0_0_8px_rgba(255,149,0,0.8)]" />
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="border-border w-[330px] rounded-2xl border border-white/15 bg-zinc-950/95 p-3 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),inset_0_-1px_1px_rgba(0,0,0,0.6),0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:w-[350px]"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg border border-orange-500/30 bg-orange-500/10 text-[#ff9500] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]">
              <Settings2 className="size-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-tight text-white">
                Feed Tuning
              </h4>
              <p className="text-[10px] text-zinc-400">
                Sources & discovery tuning
              </p>
            </div>
          </div>
          {isCustomized ? (
            <button
              className="flex cursor-pointer items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 transition-all hover:border-white/30 hover:bg-white/10 hover:text-white active:translate-y-px"
              onClick={handleReset}
              type="button"
            >
              <RotateCcw className="size-2.5" />
              Reset
            </button>
          ) : null}
        </div>

        {/* Section 1: Feed Sources */}
        <div className="flex items-center justify-between px-0.5 pt-2.5 pb-1">
          <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
            Network Source
          </span>
          {following ? (
            <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-400">
              Fixed on Following
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5">
          {SOURCE_OPTIONS.map((opt) => {
            const isSelected = activeSource === opt.value;
            return (
              <button
                key={opt.value}
                aria-pressed={isSelected}
                className={cn(
                  "group flex w-full cursor-pointer items-center justify-between rounded-xl p-2 text-left transition-all duration-150 active:translate-y-px",
                  isSelected
                    ? "border-2 border-[#ff9500] bg-orange-500/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_2px_rgba(255,255,255,0.3),0_2px_8px_rgba(255,149,0,0.25)]"
                    : "border border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.07]",
                  following &&
                    "cursor-not-allowed opacity-50 hover:border-white/10 hover:bg-white/[0.03]"
                )}
                disabled={following}
                onClick={() => {
                  if (!following) {
                    setSource(opt.value);
                  }
                }}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                      opt.iconBg
                    )}
                  >
                    {opt.icon}
                  </div>
                  <div className="min-w-0">
                    <span
                      className={cn(
                        "block truncate text-xs font-semibold",
                        isSelected ? "text-white" : "text-zinc-300"
                      )}
                    >
                      {opt.label}
                    </span>
                    <p className="truncate text-[10px] text-zinc-400">
                      {opt.description}
                    </p>
                  </div>
                </div>
                {isSelected ? (
                  <span className="ml-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ff9500] text-black shadow-sm">
                    <Check className="size-3 stroke-[3]" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Section 2: Content Language */}
        <div className="flex items-center justify-between px-0.5 pt-3 pb-1.5">
          <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
            <Languages className="size-3 text-zinc-400" />
            Language Filter
          </span>
          <span className="text-[10px] font-medium text-zinc-400 capitalize">
            {getLanguageLabel(activeLanguage)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/40 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
          {LANGUAGE_OPTIONS.map((lang) => {
            const isLangSelected = activeLanguage === lang.value;
            return (
              <button
                key={lang.value}
                aria-pressed={isLangSelected}
                className={cn(
                  "cursor-pointer rounded-lg py-1.5 text-xs font-semibold transition-all duration-150 active:translate-y-px",
                  isLangSelected
                    ? "scale-[1.02] border border-white/30 bg-white/20 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_1px_3px_rgba(0,0,0,0.4)]"
                    : "border border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                )}
                onClick={() => setLanguage(lang.value)}
                type="button"
              >
                {lang.label}
              </button>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-black/30 p-2 text-[10px] leading-snug text-zinc-400">
          <Info className="border-border mt-0.5 size-3.5 shrink-0 text-[#ff9500]" />
          <span>
            {following
              ? "Following tab strictly displays people you follow on asocialmedia."
              : "Preferences automatically apply to your feed algorithms & network discovery."}
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
