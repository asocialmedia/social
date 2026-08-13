"use client";

import { clientLog } from "@asm/config/debug";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Command } from "cmdk";
import { Loader2, Search, X } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { type MouseEvent, useCallback, useState } from "react";
import { useSession } from "@/app/(main)/session-provider";
import { useToast } from "@/lib/gooey-toast";
import { useUpdateMentionsMutation } from "@/posts/editor/mutations";
import UserAvatar from "../layouts/user-avatar";

const tagVariants: Variants = {
  initial: { opacity: 0, scale: 0.9, y: -10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 200,
      damping: 20,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    y: -10,
    transition: {
      duration: 0.2,
    },
  },
};

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

interface MentionTagEditorProps {
  initialMentions: UserData[];
  onCloseAction: () => void;
  onMentionsUpdateAction: (mentions: UserData[]) => void;
  postId?: string;
}

export function MentionTagEditor({
  postId,
  initialMentions,
  onCloseAction,
  onMentionsUpdateAction,
}: MentionTagEditorProps) {
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<UserData[]>([]);
  const { toast } = useToast();
  const [selectedMentions, setSelectedMentions] =
    useState<UserData[]>(initialMentions);
  const updateMentions = useUpdateMentionsMutation(postId);
  const { user: currentUser } = useSession();

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
        if (!res.ok) {
          throw new Error("Failed to search users");
        }
        const data = await res.json();

        setSuggestions(data.users);
      } catch (error) {
        clientLog.error("Error searching users:", error);
        toast({
          title: "No Luck Finding People",
          description: "Try searching again in a moment",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [toast]
  );

  const handleSelect = useCallback(
    (user: UserData) => {
      if (selectedMentions.length >= 5) {
        toast({
          title: "Up to 5 Mentions",
          description: "You can mention up to 5 people per post",
          variant: "destructive",
        });
        return;
      }

      if (!selectedMentions.some((m) => m.id === user.id)) {
        const newMentions = [...selectedMentions, user];
        setSelectedMentions(newMentions);
        onMentionsUpdateAction(newMentions);
      }
      setSearch("");
    },
    [selectedMentions, onMentionsUpdateAction, toast]
  );

  const handleRemove = useCallback(
    (userId: string) => {
      const newMentions = selectedMentions.filter((m) => m.id !== userId);
      setSelectedMentions(newMentions);
      onMentionsUpdateAction(newMentions);
    },
    [selectedMentions, onMentionsUpdateAction]
  );

  const isCurrentUser = (userId: string) => currentUser?.id === userId;

  const handleValueChange = useCallback(
    (value: string) => {
      setSearch(value);
      searchUsers(value);
    },
    [searchUsers]
  );

  const handleRemoveClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const { userId } = e.currentTarget.dataset;
      if (userId !== undefined) {
        handleRemove(userId);
      }
    },
    [handleRemove]
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

  const handleSave = useCallback(async () => {
    try {
      onMentionsUpdateAction(selectedMentions);
      onCloseAction();

      await updateMentions.mutateAsync(selectedMentions.map((m) => m.id));
    } catch {
      toast({
        description: "Couldn't save your mentions, try again?",
        variant: "destructive",
      });
    }
  }, [
    onMentionsUpdateAction,
    onCloseAction,
    updateMentions,
    selectedMentions,
    toast,
  ]);

  return (
    <div>
      <motion.div
        animate="animate"
        className="space-y-2"
        initial="initial"
        variants={containerVariants}
      >
        {selectedMentions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <AnimatePresence mode="popLayout">
              {selectedMentions.map((user) => (
                <motion.div
                  className="meta-chip meta-chip-mention"
                  key={user.id}
                  layout
                  variants={tagVariants}
                >
                  <UserAvatar size={16} user={user} />
                  <span className="font-medium text-xs">
                    @{user.username}
                    {isCurrentUser(user.id) && (
                      <span className="ml-1 text-[10px] opacity-70">(you)</span>
                    )}
                  </span>
                  <button
                    aria-label={`Remove mention ${user.username}`}
                    className="meta-chip-accent flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-destructive"
                    data-user-id={user.id}
                    onClick={handleRemoveClick}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : null}

        <div className="relative rounded-xl transition-all duration-200">
          <Command className="premium-command overflow-hidden">
            <div className="flex items-center px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                className="h-9 flex-1 border-0 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/70 focus:ring-0"
                onValueChange={handleValueChange}
                placeholder="Search users to mention..."
                value={search}
              />
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
            <Command.List className="max-h-[180px] overflow-y-auto p-1.5">
              {suggestions.map((user) => (
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
                      {isCurrentUser(user.id) && (
                        <span className="ml-1 text-blue-400">(you)</span>
                      )}
                    </span>
                  </div>
                </Command.Item>
              ))}
              {search && !isLoading && suggestions.length === 0 && (
                <p className="p-2 text-muted-foreground text-sm">
                  No users found matching "{search}"
                </p>
              )}
            </Command.List>
          </Command>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            className="pill-3d-hover text-muted-foreground"
            onClick={onCloseAction}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="btn-3d min-w-20 rounded-full px-5 py-2 text-sm"
            onClick={handleSave}
          >
            Save Changes
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
