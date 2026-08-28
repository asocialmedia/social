"use client";

import { clientLog } from "@asm/config/debug";
import type { UserData } from "@asm/db";
import { Command } from "cmdk";
import { Hash, Loader2, Plus, Search, X } from "lucide-react";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { useTags } from "@/hooks/use-tags";
import { useToast } from "@/lib/gooey-toast";

// Compact tag + mention pickers for the gust composer. Unlike the post
// dialog editors (TagEditor / MentionTagEditor) these write straight into
// the composer's local state - publish carries tags/mentions in the payload,
// so nothing is saved to the server here.

const MAX_TAGS = 5;
const MAX_MENTIONS = 5;

// React Compiler cannot lower `throw` statements inside hook try blocks, so
// response status checks live in this module-scoped helper.
function ensureResponseOk(response: Response, message: string): void {
  if (!response.ok) {
    throw new Error(message);
  }
}

interface GustTagPickerProps {
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  selectedTags: string[];
}

export function GustTagPicker({
  onAdd,
  onRemove,
  selectedTags,
}: GustTagPickerProps) {
  const [search, setSearch] = useState("");
  const { searchTags, suggestions } = useTags();
  const { toast } = useToast();

  const handleSelect = useCallback(
    (tagName: string) => {
      if (selectedTags.length >= MAX_TAGS) {
        toast({
          description: "You can add up to 5 tags per gust",
          title: "Up to 5 Tags",
          variant: "destructive",
        });
        return;
      }
      if (!selectedTags.includes(tagName)) {
        onAdd(tagName.toLowerCase());
      }
      setSearch("");
    },
    [onAdd, selectedTags, toast]
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value);
      void searchTags(value);
    },
    [searchTags]
  );

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-xs font-semibold">Tags</p>
        <p className="text-muted-foreground text-[11px]">
          Up to 5 - help people find your gust.
        </p>
      </div>
      {selectedTags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedTags.map((tagName) => (
            <span className="meta-chip meta-chip-tag" key={tagName}>
              <Hash className="meta-chip-accent h-3.5 w-3.5" />
              <span className="text-xs font-medium">{tagName}</span>
              <button
                aria-label={`Remove tag ${tagName}`}
                className="meta-chip-accent text-muted-foreground hover:text-destructive flex h-4 w-4 items-center justify-center rounded-full transition-colors"
                onClick={() => onRemove(tagName)}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Command className="premium-command overflow-hidden">
        <div className="flex items-center px-3">
          <Search className="text-muted-foreground mr-2 h-4 w-4 shrink-0" />
          <Command.Input
            className="placeholder:text-muted-foreground/70 h-9 flex-1 border-0 bg-transparent text-sm outline-hidden focus:ring-0"
            onValueChange={handleSearch}
            placeholder="Search or create a tag…"
            value={search}
          />
        </div>
        {search ? (
          <Command.List className="max-h-45 overflow-y-auto p-1.5">
            {suggestions?.includes(search) ? null : (
              <Command.Item
                className="pill-3d-hover group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm"
                onSelect={handleSelect}
                value={search}
              >
                <Plus className="text-primary/70 group-hover:text-primary h-4 w-4 transition-colors" />
                <span>
                  Create tag "<span className="font-medium">{search}</span>"
                </span>
              </Command.Item>
            )}
            {suggestions?.map((tagName: string) => (
              <Command.Item
                className="pill-3d-hover group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm"
                key={tagName}
                onSelect={handleSelect}
                value={tagName}
              >
                <Hash className="text-primary/70 group-hover:text-primary h-4 w-4 transition-colors" />
                <span className="font-medium">{tagName}</span>
              </Command.Item>
            ))}
          </Command.List>
        ) : null}
      </Command>
    </div>
  );
}

interface GustMentionPickerProps {
  onAdd: (user: UserData) => void;
  onRemove: (userId: string) => void;
  selectedMentions: UserData[];
}

export function GustMentionPicker({
  onAdd,
  onRemove,
  selectedMentions,
}: GustMentionPickerProps) {
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<UserData[]>([]);
  const { user: currentUser } = useSession();
  const { toast } = useToast();

  const searchUsers = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSuggestions([]);
        return;
      }
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(query)}`
        );
        ensureResponseOk(res, "Failed to search users");
        const data = await res.json();
        setSuggestions(data.users);
      } catch (error) {
        clientLog.error("Error searching users:", error);
        toast({
          description: "Try searching again in a moment",
          title: "No Luck Finding People",
          variant: "destructive",
        });
      }
      setIsLoading(false);
    },
    [toast]
  );

  const handleSelect = useCallback(
    (user: UserData) => {
      // Self-mentions are dropped server-side (aura-farming guard), so the
      // picker never offers the current user - selecting yourself would
      // silently lose the mention at publish.
      if (user.id === currentUser?.id) {
        return;
      }
      if (selectedMentions.length >= MAX_MENTIONS) {
        toast({
          description: "You can mention up to 5 people per gust",
          title: "Up to 5 Mentions",
          variant: "destructive",
        });
        return;
      }
      if (!selectedMentions.some((m) => m.id === user.id)) {
        onAdd(user);
      }
      setSearch("");
    },
    [currentUser?.id, onAdd, selectedMentions, toast]
  );

  const handleValueChange = useCallback(
    (value: string) => {
      setSearch(value);
      void searchUsers(value);
    },
    [searchUsers]
  );

  const handleSelectValue = useCallback(
    (value: string) => {
      const user = suggestions.find((u) => u.username === value);
      if (user) {
        handleSelect(user);
      }
    },
    [suggestions, handleSelect]
  );

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-xs font-semibold">Mentions</p>
        <p className="text-muted-foreground text-[11px]">
          Credit up to 5 people in your gust.
        </p>
      </div>
      {selectedMentions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedMentions.map((user) => (
            <span className="meta-chip meta-chip-mention" key={user.id}>
              <UserAvatar size={16} user={user} />
              <span className="text-xs font-medium">@{user.username}</span>
              <button
                aria-label={`Remove mention ${user.username}`}
                className="meta-chip-accent text-muted-foreground hover:text-destructive flex h-4 w-4 items-center justify-center rounded-full transition-colors"
                onClick={() => onRemove(user.id)}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Command className="premium-command overflow-hidden">
        <div className="flex items-center px-3">
          <Search className="text-muted-foreground mr-2 h-4 w-4 shrink-0" />
          <Command.Input
            className="placeholder:text-muted-foreground/70 h-9 flex-1 border-0 bg-transparent text-sm outline-hidden focus:ring-0"
            onValueChange={handleValueChange}
            placeholder="Search people to mention…"
            value={search}
          />
          {isLoading ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : null}
        </div>
        {search ? (
          <Command.List className="max-h-45 overflow-y-auto p-1.5">
            {suggestions
              .filter((user) => user.id !== currentUser?.id)
              .map((user) => (
                <Command.Item
                  className="pill-3d-hover group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm"
                  key={user.id}
                  onSelect={handleSelectValue}
                  value={user.username}
                >
                  <UserAvatar size={24} user={user} />
                  <div className="flex flex-col">
                    <span className="font-medium">{user.displayName}</span>
                    <span className="text-muted-foreground text-xs">
                      @{user.username}
                    </span>
                  </div>
                </Command.Item>
              ))}
            {!isLoading &&
            suggestions.filter((user) => user.id !== currentUser?.id).length ===
              0 ? (
              <p className="text-muted-foreground p-2 text-sm">
                No people found matching &quot;{search}&quot;
              </p>
            ) : null}
          </Command.List>
        ) : null}
      </Command>
    </div>
  );
}
