"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

interface RegionOption {
  code: string;
  name: string;
}

// A row-shaped picker rather than a native select. Two reasons this is not the
// shared Select primitive: its trigger carries `[&>span]:line-clamp-1`, which
// forces a direct span child to display:-webkit-box and breaks the icon-plus-text
// row layout, and a flat menu of ~250 regions needs a search field that a native
// select cannot express. The row keeps the app's filled 3D hover, and each option
// is a plain toggle button (aria-pressed), so no listbox role is invented here.
export function RegionPicker({
  description,
  disabled,
  icon: Icon,
  label,
  onChange,
  options,
  value,
  valueLabel,
}: {
  description: string;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onChange: (code: string) => void;
  options: RegionOption[];
  value: string;
  valueLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(query) ||
        option.code.toLowerCase().includes(query)
    );
  }, [options, search]);

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch("");
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className="pill-3d-hover flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-50"
          disabled={disabled}
          type="button"
        >
          <span className="surface-3d flex size-9 shrink-0 items-center justify-center rounded-xl!">
            <Icon className="text-foreground size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{label}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {valueLabel}
            </span>
            <span className="sr-only">{description}</span>
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        sideOffset={6}
      >
        <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            aria-label="Search regions"
            autoComplete="off"
            className="placeholder:text-muted-foreground text-foreground w-full bg-transparent text-sm outline-none"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search regions"
            value={search}
          />
        </div>
        <div className="hide-native-scrollbar max-h-64 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">
              No regions found
            </p>
          ) : (
            filtered.map((option) => {
              const selected = option.code === value;
              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    "hover:bg-accent/50 flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    selected && "text-foreground font-medium"
                  )}
                  key={option.code}
                  onClick={() => choose(option.code)}
                  type="button"
                >
                  <span className="truncate">{option.name}</span>
                  {selected ? (
                    <Check className="text-primary size-4 shrink-0" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
