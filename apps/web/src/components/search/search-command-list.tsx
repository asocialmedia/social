"use client";

import type { SearchSuggestion } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@asm/ui/shadui/command";
import { History, TrendingUp, X } from "lucide-react";

interface SearchCommandListProps {
  history?: string[];
  input: string;
  onClearHistory?: () => void;
  onRemoveHistoryItem?: (query: string) => void;
  onSelectAction: (value: string) => void;
  suggestions?: SearchSuggestion[];
}

export function SearchCommandList({
  input,
  suggestions,
  history,
  onSelectAction,
  onClearHistory,
  onRemoveHistoryItem,
}: SearchCommandListProps) {
  return (
    <Command className="rounded-xl border bg-popover/95 shadow-lg backdrop-blur-xl">
      <CommandList>
        {!(input || suggestions?.length || history?.length) && (
          <CommandEmpty className="py-6 text-center text-sm">
            No results found.
          </CommandEmpty>
        )}

        {suggestions && suggestions.length > 0 && (
          <CommandGroup className="space-y-1.5" heading="Suggestions">
            {suggestions.map((suggestion) => (
              <CommandItem
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-primary/10"
                key={suggestion.query}
                onSelect={onSelectAction}
                value={suggestion.query}
              >
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span>{suggestion.query}</span>
                <span className="ml-auto text-muted-foreground text-xs">
                  {suggestion.count} searches
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!input && history && history.length > 0 && (
          <CommandGroup className="space-y-1.5">
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="font-medium text-sm">Recent Searches</span>
              {onClearHistory && (
                <Button
                  className="h-auto px-2 py-1 text-muted-foreground text-xs hover:text-primary"
                  onClick={(e) => {
                    e.preventDefault();
                    onClearHistory();
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Clear all
                </Button>
              )}
            </div>
            {history.map((query) => (
              <CommandItem
                className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-primary/10"
                key={query}
                onSelect={onSelectAction}
                value={query}
              >
                <History className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{query}</span>
                {onRemoveHistoryItem && (
                  <Button
                    className="h-auto p-1 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemoveHistoryItem(query);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-primary" />
                  </Button>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
