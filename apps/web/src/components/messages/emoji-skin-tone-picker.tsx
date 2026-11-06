"use client";

import { REACTION_SKIN_TONES } from "@asm/messages";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

const TONE_PREVIEWS = ["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"] as const;

export function EmojiSkinTonePicker({
  disabled,
  onChange,
  tone,
}: {
  disabled: boolean;
  onChange: (tone: number) => void;
  tone: number;
}) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`Emoji skin tone: ${REACTION_SKIN_TONES[tone]}`}
          className="chip-3d text-muted-foreground hover:text-foreground focus-visible:ring-primary flex h-9 shrink-0 items-center gap-2 rounded-full px-3 transition-colors focus-visible:ring-2 disabled:opacity-40 pointer-coarse:h-11"
          disabled={disabled}
          title="Change emoji skin tone"
          type="button"
        >
          <span aria-hidden className="text-xl leading-none">
            {TONE_PREVIEWS[tone]}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              open && "rotate-180"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Emoji skin tone"
        className="w-76 max-w-[calc(100vw-1rem)] p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectedRef.current?.focus();
        }}
        sideOffset={8}
      >
        <div className="mb-2 flex items-center justify-between gap-3 px-2 pt-1">
          <span className="text-xs font-medium">Skin tone</span>
          <span className="text-muted-foreground text-xs">
            {REACTION_SKIN_TONES[tone]}
          </span>
        </div>
        <fieldset className="grid min-w-0 grid-cols-6 gap-1">
          <legend className="sr-only">Skin tone choices</legend>
          {REACTION_SKIN_TONES.map((label, index) => (
            <button
              aria-label={`${label} skin tone`}
              aria-pressed={tone === index}
              className={cn(
                "focus-visible:ring-primary relative flex h-12 min-w-0 items-center justify-center rounded-xl text-2xl transition-colors focus-visible:ring-2 focus-visible:ring-inset",
                tone === index
                  ? "bg-primary/10 ring-primary/50 ring-1 ring-inset"
                  : "hover:bg-muted/70"
              )}
              key={label}
              onClick={() => {
                onChange(index);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                const positions: Record<string, number> = {
                  ArrowLeft: (index + 5) % 6,
                  ArrowRight: (index + 1) % 6,
                  End: 5,
                  Home: 0,
                };
                const next = positions[event.key];
                if (next === undefined) {
                  return;
                }
                event.preventDefault();
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  .item(next)
                  ?.focus();
              }}
              ref={tone === index ? selectedRef : undefined}
              title={label}
              type="button"
            >
              <span aria-hidden>{TONE_PREVIEWS[index]}</span>
              {tone === index ? (
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground absolute right-0.5 bottom-0.5 flex size-3.5 items-center justify-center rounded-full"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              ) : null}
            </button>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
