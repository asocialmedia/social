"use client";
// oxlint-disable jsx-a11y/prefer-tag-over-role -- Virtualized ARIA grid rows and cells use absolute positioning rather than table layout.

// oxlint-disable react/exhaustive-effect-dependencies -- Retry revisions reload the catalog; query/category changes reset the scroll position.

import {
  loadReactionCatalog,
  REACTION_CATEGORIES,
  searchReactionEmojis,
} from "@asm/messages";
import type { ReactionCatalog } from "@asm/messages";
import { Input } from "@asm/ui/shadui/input";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Coffee,
  Flag,
  Hand,
  Heart,
  Leaf,
  Lightbulb,
  Plane,
  Search,
  Smile,
  Trophy,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import { cn } from "@/lib/utils";

import { EmojiSkinTonePicker } from "./emoji-skin-tone-picker";

const CATEGORY_ICONS = [
  Smile,
  Hand,
  Leaf,
  Coffee,
  Plane,
  Trophy,
  Lightbulb,
  Heart,
  Flag,
];
const COLUMNS = 6;

export function MessageReactionPicker({
  onBack,
  onReact,
  disabled = false,
  title = "Reactions",
}: {
  onBack?: () => void;
  onReact: (emoji: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [catalog, setCatalog] = useState<ReactionCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(0);
  const [tone, setTone] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await loadReactionCatalog();
        if (active) {
          setCatalog(value);
          setFailed(false);
        }
      } catch {
        if (active) {
          setFailed(true);
        }
      }
    })();
    // Keep the software keyboard closed until someone taps Search on a phone.
    if (window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
    return () => {
      active = false;
    };
  }, [attempt]);

  const results = catalog
    ? searchReactionEmojis(catalog, deferredQuery, group, tone)
    : [];
  // oxlint-disable-next-line react/incompatible-library -- Virtualizer handles intentionally remain outside compiler memoization.
  const rows = useVirtualizer({
    count: Math.ceil(results.length / COLUMNS),
    estimateSize: () => 46,
    getScrollElement: () => scrollRef.current,
    overscan: 3,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [deferredQuery, group]);
  useEffect(() => {
    if (pendingFocus.current !== null) {
      scrollRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-emoji-index="${pendingFocus.current}"]`
        )
        ?.focus();
      pendingFocus.current = null;
    }
  });

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
      <div className="mb-2 flex items-center gap-2">
        {onBack ? (
          <button
            aria-label="Back to message options"
            className="hover:bg-muted/60 focus-visible:ring-primary flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:ring-2"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <span className="flex-1 text-sm font-medium">{title}</span>
        <EmojiSkinTonePicker
          disabled={disabled}
          onChange={setTone}
          tone={tone}
        />
      </div>
      <div className="relative mb-2">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-3 left-3 size-4"
        />
        <Input
          aria-label="Search emojis"
          autoComplete="off"
          className="h-10 rounded-xl pl-9 text-base sm:text-sm"
          maxLength={80}
          onChange={(event) => {
            setQuery(event.target.value);
            setFocusedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              setFocusedIndex(0);
              rows.scrollToIndex(0);
              requestAnimationFrame(() =>
                scrollRef.current
                  ?.querySelector<HTMLButtonElement>('[data-emoji-index="0"]')
                  ?.focus()
              );
            }
          }}
          placeholder="Search emojis"
          ref={inputRef}
          value={query}
        />
      </div>
      <div
        aria-label="Emoji categories"
        className="border-border/40 mb-2 flex [scrollbar-width:none] overflow-x-auto border-b pb-1 [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {REACTION_CATEGORIES.map((category, index) => {
          const Icon = CATEGORY_ICONS[index] ?? Smile;
          return (
            <button
              aria-label={category.label}
              aria-selected={group === category.id && !query}
              className={cn(
                "text-muted-foreground hover:text-foreground focus-visible:ring-primary flex h-11 min-w-8 flex-1 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 pointer-coarse:min-w-11",
                group === category.id && !query && "bg-muted/70 text-foreground"
              )}
              key={category.id}
              onClick={() => {
                setGroup(category.id);
                setQuery("");
                setFocusedIndex(0);
              }}
              role="tab"
              type="button"
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      <div
        tabIndex={0}
        aria-label="Emoji choices"
        role="grid"
        aria-colcount={COLUMNS}
        aria-rowcount={Math.ceil(results.length / COLUMNS)}
        className="relative h-[min(42dvh,276px)] min-h-32 overflow-y-auto overscroll-contain"
        onKeyDown={(event) => {
          if (
            !(event.target instanceof HTMLButtonElement) ||
            !event.target.dataset.emojiIndex
          ) {
            return;
          }
          const current = Number(event.target.dataset.emojiIndex);
          const offsets: Record<string, number> = {
            ArrowDown: COLUMNS,
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -COLUMNS,
          };
          const offset = offsets[event.key];
          if (offset === undefined) {
            return;
          }
          event.preventDefault();
          const next = Math.max(
            0,
            Math.min(results.length - 1, current + offset)
          );
          pendingFocus.current = next;
          setFocusedIndex(next);
          rows.scrollToIndex(Math.floor(next / COLUMNS));
          requestAnimationFrame(() =>
            scrollRef.current
              ?.querySelector<HTMLButtonElement>(`[data-emoji-index="${next}"]`)
              ?.focus()
          );
        }}
        ref={scrollRef}
      >
        {catalog ? null : (
          <output className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {failed ? (
              <button
                className="underline underline-offset-4"
                onClick={() => setAttempt((value) => value + 1)}
                type="button"
              >
                Retry loading emojis
              </button>
            ) : (
              <span className="flex flex-col items-center gap-2">
                <ZephLoader size={48} />
                Loading emojis…
              </span>
            )}
          </output>
        )}
        {catalog && results.length === 0 ? (
          <output className="text-muted-foreground block py-12 text-center text-sm">
            No emojis found
          </output>
        ) : null}
        <div
          className="relative w-full"
          style={{ height: rows.getTotalSize() }}
        >
          {rows.getVirtualItems().map((row) => (
            <div
              role="row"
              aria-rowindex={row.index + 1}
              className="absolute top-0 left-0 grid w-full grid-cols-6"
              key={row.key}
              style={{
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {results
                .slice(row.index * COLUMNS, (row.index + 1) * COLUMNS)
                .map((entry, column) => (
                  <div
                    role="gridcell"
                    aria-colindex={column + 1}
                    key={entry.emoji}
                  >
                    <button
                      aria-label={`React with ${entry.label}`}
                      className="hover:bg-muted/70 focus-visible:ring-primary flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl text-2xl transition-[background-color,transform] duration-150 focus-visible:ring-2 disabled:opacity-40 motion-safe:active:scale-90"
                      data-emoji-index={row.index * COLUMNS + column}
                      disabled={disabled}
                      tabIndex={
                        row.index * COLUMNS + column === focusedIndex ? 0 : -1
                      }
                      onFocus={() =>
                        setFocusedIndex(row.index * COLUMNS + column)
                      }
                      onClick={() => onReact(entry.emoji)}
                      title={entry.label}
                      type="button"
                    >
                      {entry.emoji}
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
