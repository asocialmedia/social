"use client";

import { Input } from "@asm/ui/shadui/input";
import { Search, X } from "lucide-react";
import type * as React from "react";
import { useCallback, useRef } from "react";

import { cn } from "@/lib/utils";

interface HNSearchBarProps {
  className?: string;
  onSearchChange: (value: string) => void;
  search: string;
}

export const HNSearchBar = ({
  className,
  onSearchChange,
  search,
}: HNSearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className={cn("flex w-full items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          aria-label="Search HackerNews stories"
          autoComplete="off"
          className="focus-visible:ring-primary h-10 w-full !bg-[hsl(var(--background-alt))] py-2.5 pr-8 pl-9 transition-all duration-300 ease-in-out focus-visible:ring-2"
          onChange={handleChange}
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
    </div>
  );
};
