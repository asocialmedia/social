"use client";

import type { FeedSource } from "@asm/protocols/discovery";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import asmLogo from "@assets/asm.png";
import { Check, RotateCcw, Settings2 } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useSyncExternalStore } from "react";

import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { cn } from "@/lib/utils";
import { useFeedSourceStore } from "@/store/feed-source-store";

// Filled selections reuse the app's brand surfaces so the menu looks like the
// rest of the UI: orange for asocialmedia, Bluesky blue for the bridge.
const ORANGE_FILL =
  "orange-3d-surface bg-linear-to-b from-[#ff9500] to-[#e65500] text-white";
const BLUESKY_FILL = "bluesky-3d-surface text-white";

interface SourceOption {
  value: FeedSource;
  label: string;
  description: string;
  mark: React.ReactNode;
  // Tone the bare mark wears on an unselected row, so it keeps its brand colour
  // without the row's muted text colour bleeding into it.
  idleTone?: string;
  // The asm logo keeps its brand orange on neutral rows and flips to a white
  // silhouette on the filled orange row.
  whiteOnFill?: boolean;
}

// Two interlocking rings stand for "both networks in one stream".
const AllNetworksMark = () => (
  <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
    <circle cx="6.3" cy="8" r="4.3" stroke="currentColor" strokeWidth="1.5" />
    <circle
      cx="9.7"
      cy="8"
      opacity="0.5"
      r="4.3"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

const SOURCE_OPTIONS: SourceOption[] = [
  {
    description: "asocialmedia and Bluesky together",
    label: "All networks",
    mark: <AllNetworksMark />,
    value: "all",
  },
  {
    description: "Local communities and posts",
    label: "asocialmedia",
    mark: <Image alt="" className="h-4 w-auto" src={asmLogo} />,
    value: "asm",
    whiteOnFill: true,
  },
  {
    description: "Public AT Protocol discovery",
    // text-current makes the mark inherit the row's tone. Without it the icon's
    // own text-sky-500 wins and the butterfly stays dark on its own blue fill.
    idleTone: "text-sky-500",
    label: "Bluesky",
    mark: <BlueskyIcon className="size-4 text-current" tooltip={false} />,
    value: "bluesky",
  },
];

const LANGUAGE_OPTIONS = [
  { label: "Device", value: "auto" },
  { label: "English", value: "en" },
  { label: "All", value: "all" },
] as const;

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
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`Feed settings, source: ${
            following ? "asocialmedia" : activeSource
          }`}
          className={cn(
            "surface-3d bg-background text-muted-foreground relative ml-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full",
            "hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none active:translate-y-px",
            "transition-colors",
            isCustomized && "text-foreground"
          )}
          suppressHydrationWarning
          type="button"
        >
          <Settings2 className="size-4" />
          {isCustomized ? (
            <span
              aria-hidden
              className="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-[hsl(var(--background-alt))]"
            />
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-76 max-w-[calc(100vw-1.5rem)] p-2.5 sm:w-84"
        sideOffset={8}
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <h2 className="text-foreground text-sm font-semibold">Feed tuning</h2>
          {isCustomized ? (
            <button
              className="chip-3d text-muted-foreground hover:text-foreground focus-visible:ring-ring flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
              onClick={handleReset}
              type="button"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          {SOURCE_OPTIONS.map((opt) => {
            const isSelected = activeSource === opt.value;
            const isLocked = following && opt.value !== "asm";
            let fill: string | null = null;
            if (opt.value === "asm") {
              fill = ORANGE_FILL;
            } else if (opt.value === "bluesky") {
              fill = BLUESKY_FILL;
            }

            let rowSkin = "text-foreground group sidebar-row-hover";
            if (isSelected) {
              // The neutral "All networks" selection sits a step above the panel
              // (bg-card) so it still reads as chosen on the dark theme, where a
              // plain surface-3d fill matches the panel exactly.
              rowSkin = fill ?? "surface-3d bg-card text-foreground";
            }

            return (
              <button
                key={opt.value}
                aria-pressed={isSelected}
                className={cn(
                  "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:outline-none",
                  "active:translate-y-px",
                  rowSkin,
                  isLocked && "pointer-events-none opacity-45"
                )}
                disabled={isLocked}
                onClick={() => setSource(opt.value)}
                type="button"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center",
                    isSelected
                      ? ""
                      : cn(
                          // Brand marks keep their own colour on hover, the same
                          // way the trending rows do; neutral glyphs inherit.
                          opt.idleTone ??
                            "text-muted-foreground transition-colors group-hover:text-inherit"
                        ),
                    isSelected && fill && opt.whiteOnFill
                      ? "brightness-0 invert"
                      : ""
                  )}
                >
                  {opt.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[13px] leading-tight font-semibold",
                      isSelected
                        ? ""
                        : "transition-colors group-hover:text-inherit"
                    )}
                  >
                    {opt.label}
                  </span>
                  <span
                    className={cn(
                      "text-muted-foreground block truncate text-[11px] leading-tight",
                      isSelected && fill
                        ? "text-white/80"
                        : "transition-colors group-hover:text-inherit"
                    )}
                  >
                    {opt.description}
                  </span>
                </span>
                {isSelected ? (
                  <Check
                    aria-hidden
                    className="size-4 shrink-0"
                    strokeWidth={3}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2 px-1">
          <span className="text-muted-foreground text-xs font-medium">
            Language
          </span>
          <fieldset
            aria-label="Content language"
            className="surface-3d flex min-w-0 items-center gap-0.5 rounded-lg p-0.5"
          >
            {LANGUAGE_OPTIONS.map((lang) => {
              const isLangSelected = activeLanguage === lang.value;
              return (
                <button
                  key={lang.value}
                  aria-pressed={isLangSelected}
                  className="tabs-segment-3d text-muted-foreground hover:text-foreground data-[state=active]:text-foreground focus-visible:ring-ring cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
                  data-state={isLangSelected ? "active" : "inactive"}
                  onClick={() => setLanguage(lang.value)}
                  type="button"
                >
                  {lang.label}
                </button>
              );
            })}
          </fieldset>
        </div>

        {following ? (
          <p className="text-muted-foreground mt-2 px-1 text-[11px] leading-snug">
            Following only shows people you follow on asocialmedia.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
