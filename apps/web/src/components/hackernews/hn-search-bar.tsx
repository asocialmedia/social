"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Input } from "@asm/ui/shadui/input";
import {
  Activity,
  Briefcase,
  Check,
  ChevronDown,
  HelpCircle,
  Newspaper,
  Search,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export const HN_FILTER_OPTIONS = [
  { icon: Newspaper, id: "all", label: "All Stories" },
  { icon: Activity, id: "story", label: "News" },
  { icon: Briefcase, id: "job", label: "Jobs" },
  { icon: Newspaper, id: "show", label: "Show HN" },
  { icon: HelpCircle, id: "ask", label: "Ask HN" },
] as const;

export type HNFilterId = (typeof HN_FILTER_OPTIONS)[number]["id"];

interface HNSearchBarProps {
  className?: string;
  filter: HNFilterId;
  onFilterChange: (filter: HNFilterId) => void;
  onSearchChange: (value: string) => void;
  search: string;
}

export const HNSearchBar = ({
  className,
  filter,
  onFilterChange,
  onSearchChange,
  search,
}: HNSearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const activeFilter =
    HN_FILTER_OPTIONS.find((option) => option.id === filter) ??
    HN_FILTER_OPTIONS[0];

  const handleClear = useCallback(() => {
    onSearchChange("");
    inputRef.current?.focus();
  }, [onSearchChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSearchChange(e.target.value);
    },
    [onSearchChange]
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  const handleSelectFilter = useCallback(
    (option: HNFilterId) => () => {
      onFilterChange(option);
    },
    [onFilterChange]
  );

  return (
    <div className={cn("flex w-full items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <Search
          className={cn(
            "pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 transition-colors",
            isFocused ? "text-orange-500" : "text-muted-foreground"
          )}
        />
        <Input
          aria-label="Search HackerNews stories"
          autoComplete="off"
          className={cn(
            "h-10 w-full rounded-full",
            "bg-background/50 pr-8 pl-9 backdrop-blur-sm",
            "border-muted-foreground/20",
            "placeholder:text-muted-foreground/50",
            "focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20",
            "transition-all duration-200"
          )}
          onBlur={handleBlur}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder="Search stories..."
          ref={inputRef}
          type="text"
          value={search}
        />
        {search ? (
          <button
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 z-10 -translate-y-1/2 transition-colors"
            onClick={handleClear}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="btn-3d-gray flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-full px-3 text-[11px] text-white transition-all active:translate-y-px"
            type="button"
          >
            <activeFilter.icon className="h-3.5 w-3.5" />
            <span className="hidden text-[11px]! font-medium! sm:inline">
              {activeFilter.label}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="apple-panel min-w-44 p-1.5 shadow-none"
        >
          {HN_FILTER_OPTIONS.map((option) => (
            <DropdownMenuItem
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2",
                option.id === filter &&
                  "bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400"
              )}
              key={option.id}
              onSelect={handleSelectFilter(option.id)}
            >
              <option.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{option.label}</span>
              {option.id === filter ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
