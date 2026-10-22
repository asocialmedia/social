"use client";

import {
  COMMUNITY_POST_RANGES,
  COMMUNITY_POST_RATINGS,
  COMMUNITY_POST_TYPES,
  communityPostFilterCount,
  readCommunityFeedSelection,
} from "@asm/db/communities";
import type { CommunityFeedSelection } from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Label } from "@asm/ui/shadui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import { SlidersHorizontal, X } from "lucide-react";
import { useId, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";

export default function CommunityPostFilters({
  selection,
  onChange,
}: {
  selection: CommunityFeedSelection;
  onChange: (selection: CommunityFeedSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selection);
  const id = useId();
  const count = communityPostFilterCount(selection);
  const mobile = useMediaQuery("(max-width: 767px)");
  const handleOpenChange = (value: boolean) => {
    if (value) {
      setDraft(selection);
    }
    setOpen(value);
  };
  const trigger = (
    <Button
      className="text-muted-foreground hover:text-foreground min-h-11 gap-2 rounded-lg px-3 text-sm font-medium"
      variant="ghost"
      aria-label={`Filter community posts${count ? `, ${count} active` : ""}`}
    >
      <SlidersHorizontal aria-hidden="true" className="size-4" />
      Filters
      {count ? (
        <span className="bg-muted text-foreground inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums">
          {count}
        </span>
      ) : null}
    </Button>
  );
  const form = (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onChange(
          readCommunityFeedSelection(
            new URLSearchParams({ ...draft, q: draft.query })
          )
        );
        setOpen(false);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Filter posts</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Choose what appears in this community’s feed.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-label="Close filters"
          onClick={() => setOpen(false)}
        >
          <X />
        </Button>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Post type</legend>
        <div className="grid grid-cols-3 gap-2">
          {COMMUNITY_POST_TYPES.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={
                draft.type === item.value ? "premium" : "premium-neutral"
              }
              className="min-h-11 px-2! text-xs"
              aria-pressed={draft.type === item.value}
              onClick={() => setDraft({ ...draft, type: item.value })}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Images, videos and audio match uploaded media. Link previews appear
          under Links.
        </p>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${id}-range`}>Posted</Label>
          <select
            className="premium-input min-h-11 w-full px-3 text-base"
            id={`${id}-range`}
            value={draft.range}
            onChange={(event) =>
              setDraft({
                ...draft,
                range: readCommunityFeedSelection(
                  new URLSearchParams({ range: event.target.value })
                ).range,
              })
            }
          >
            {COMMUNITY_POST_RANGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-rating`}>Content rating</Label>
          <select
            className="premium-input min-h-11 w-full px-3 text-base"
            id={`${id}-rating`}
            value={draft.rating}
            onChange={(event) =>
              setDraft({
                ...draft,
                rating: readCommunityFeedSelection(
                  new URLSearchParams({ rating: event.target.value })
                ).rating,
              })
            }
          >
            {COMMUNITY_POST_RATINGS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-query`}>Words in the post</Label>
        <Input
          id={`${id}-query`}
          value={draft.query}
          maxLength={120}
          placeholder="e.g. weekend sketches"
          className="min-h-11 text-base"
          onChange={(event) =>
            setDraft({ ...draft, query: event.target.value })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-author`}>Posted by</Label>
        <Input
          id={`${id}-author`}
          value={draft.author}
          maxLength={64}
          placeholder="@username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-11 text-base"
          onChange={(event) =>
            setDraft({ ...draft, author: event.target.value })
          }
        />
      </div>
      <div className="border-border flex gap-2 border-t pt-4">
        <Button
          type="button"
          variant="premium-neutral"
          className="min-h-11 flex-1 px-3!"
          onClick={() =>
            setDraft({
              ...readCommunityFeedSelection(new URLSearchParams()),
              sort: selection.sort,
            })
          }
        >
          Reset
        </Button>
        <Button
          type="submit"
          variant="premium"
          className="min-h-11 flex-1 px-3!"
        >
          Show posts
        </Button>
      </div>
    </form>
  );
  if (mobile) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto p-4"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Community post filters</DialogTitle>
          <DialogDescription className="sr-only">
            Choose post types, dates, ratings, words and an author.
          </DialogDescription>
          {form}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="max-h-[min(80dvh,42rem,var(--radix-popover-content-available-height))] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto p-5"
        aria-label="Community post filters"
      >
        {form}
      </PopoverContent>
    </Popover>
  );
}

export function CommunityPostFilterSummary({
  selection,
  onChange,
}: {
  selection: CommunityFeedSelection;
  onChange: (selection: CommunityFeedSelection) => void;
}) {
  if (!communityPostFilterCount(selection)) {
    return null;
  }
  const items = [
    {
      active: selection.type !== "all",
      key: "type",
      label: COMMUNITY_POST_TYPES.find((item) => item.value === selection.type)
        ?.label,
    },
    {
      active: selection.range !== "all",
      key: "range",
      label: COMMUNITY_POST_RANGES.find(
        (item) => item.value === selection.range
      )?.label,
    },
    {
      active: selection.rating !== "all",
      key: "rating",
      label: COMMUNITY_POST_RATINGS.find(
        (item) => item.value === selection.rating
      )?.label,
    },
    {
      active: Boolean(selection.query),
      key: "query",
      label: `“${selection.query}”`,
    },
    {
      active: Boolean(selection.author),
      key: "author",
      label: `@${selection.author}`,
    },
  ] as const;
  return (
    <div
      className="border-border/60 flex flex-wrap items-center gap-2 border-b px-3 py-2"
      aria-label="Active post filters"
    >
      {items
        .filter((item) => item.active)
        .map((item) => (
          <Button
            key={item.key}
            variant="premium-neutral"
            className="min-h-11 max-w-full gap-2 px-3! text-xs"
            aria-label={`Remove ${item.label} filter`}
            onClick={() =>
              onChange({
                ...selection,
                [item.key]:
                  item.key === "query" || item.key === "author" ? "" : "all",
              })
            }
          >
            <span className="truncate">{item.label}</span>
            <X className="size-3!" />
          </Button>
        ))}
      <Button
        variant="ghost"
        className="min-h-11 text-xs"
        onClick={() =>
          onChange({
            ...readCommunityFeedSelection(new URLSearchParams()),
            sort: selection.sort,
          })
        }
      >
        Clear filters
      </Button>
    </div>
  );
}
