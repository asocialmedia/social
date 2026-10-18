"use client";

import {
  interestSchema,
  networkTopicPageSchema,
  normalizeInterest,
} from "@asm/protocols/discovery";
import type { NetworkTopic } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

export function TopicPicker({
  label,
  selected,
  disabled,
  limit,
  onToggle,
}: {
  label: string;
  selected: string[];
  disabled: boolean;
  limit: number;
  onToggle: (topic: string) => void;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [path, setPath] = useState<NetworkTopic[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);
  const listId = useId();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const parent = path.at(-1);
  const topicQuery = useQuery({
    enabled: !debounced || debounced.length >= 2,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams();
      if (debounced) {
        query.set("q", debounced);
      } else if (parent) {
        query.set(
          "parent",
          parent.source === "wikimedia" ? parent.id : parent.label
        );
      }
      const response = await fetch(`/api/network/topics?${query}`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) {
        throw new Error("Couldn't load topic suggestions");
      }
      return networkTopicPageSchema.parse(await response.json());
    },
    queryKey: ["network-topics", debounced, parent?.id ?? "root"],
    retry: false,
    staleTime: 5 * 60_000,
  });
  const parsed = interestSchema.safeParse(search);
  const choices = topicQuery.data?.items ?? [];
  useEffect(() => {
    if (parent && topicQuery.data && !disabled) {
      void client.invalidateQueries({ queryKey: ["network-settings"] });
    }
  }, [client, disabled, parent, topicQuery.data]);
  const choose = async (topic: string) => {
    const normalized = normalizeInterest(topic);
    if (selected.includes(normalized)) {
      onToggle(normalized);
      return;
    }
    setPreparing(normalized);
    try {
      // Warm the same server taxonomy used by feeds before committing a selected root.
      await fetch(
        `/api/network/topics?${new URLSearchParams({ parent: topic })}`,
        { credentials: "include", signal: AbortSignal.timeout(8000) }
      );
    } catch {
      // Exact-topic matching remains available while the provider is offline.
    }
    setPreparing(null);
    onToggle(normalized);
  };
  return (
    <div className="space-y-3">
      <Input
        aria-controls={listId}
        aria-label={label}
        autoComplete="off"
        maxLength={64}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search topics…"
        value={search}
      />
      {path.length && !search ? (
        <div className="flex items-center gap-2 text-sm">
          <Button
            aria-label="Back to parent topics"
            onClick={() => setPath((value) => value.slice(0, -1))}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground min-w-0 truncate">
            {path.map((entry) => entry.label).join(" / ")}
          </span>
        </div>
      ) : null}
      <div
        aria-label={`${label} suggestions`}
        className="flex flex-wrap gap-2"
        id={listId}
      >
        {choices.map((entry) => {
          const value = normalizeInterest(entry.label);
          const chosen = selected.includes(value);
          return (
            <div
              className="chip-3d inline-flex items-center rounded-full!"
              key={entry.id}
            >
              <button
                aria-pressed={chosen}
                className={cn(
                  "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-sm focus-visible:ring-2 disabled:opacity-50",
                  chosen && "text-primary"
                )}
                disabled={
                  disabled ||
                  preparing !== null ||
                  (!chosen && selected.length >= limit)
                }
                onClick={() => {
                  void choose(entry.label);
                }}
                title={entry.description}
                type="button"
              >
                {preparing === value ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                {preparing !== value && chosen ? (
                  <Check className="size-3" />
                ) : null}
                {entry.label}
              </button>
              <button
                aria-label={`Explore topics related to ${entry.label}`}
                className="focus-visible:ring-ring cursor-pointer rounded-r-full border-l px-2 py-2 focus-visible:ring-2 disabled:opacity-50"
                disabled={path.some((ancestor) => ancestor.id === entry.id)}
                onClick={() => {
                  setPath((currentPath) => [...currentPath, entry]);
                  setSearch("");
                  setDebounced("");
                }}
                type="button"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      {topicQuery.isFetching ? (
        <p
          aria-live="polite"
          className="text-muted-foreground flex items-center gap-2 text-xs"
        >
          <Loader2 className="size-3 animate-spin" />
          Finding topics…
        </p>
      ) : null}
      {topicQuery.isError ? (
        <Button
          onClick={() => {
            void topicQuery.refetch();
          }}
          size="sm"
          variant="ghost"
        >
          Retry topic suggestions
        </Button>
      ) : null}
      {parsed.success &&
      !selected.includes(parsed.data) &&
      !choices.some(
        (entry) => normalizeInterest(entry.label) === parsed.data
      ) ? (
        <Button
          disabled={disabled || preparing !== null || selected.length >= limit}
          onClick={() => {
            void choose(parsed.data);
            setSearch("");
          }}
          size="sm"
          variant="outline"
        >
          <Plus className="size-3.5" />
          Add “{parsed.data}”
        </Button>
      ) : null}
      {!topicQuery.isFetching && !topicQuery.isError && !choices.length ? (
        <p className="text-muted-foreground text-xs">
          No suggestions found. You can add your own topic.
        </p>
      ) : null}
    </div>
  );
}
