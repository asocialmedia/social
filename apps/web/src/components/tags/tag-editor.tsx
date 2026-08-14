"use client";

import type { Tag, TagWithCount } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Command } from "cmdk";
import { Hash, Loader2, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Variants } from "motion/react";
import { useCallback, useState } from "react";
import type { MouseEvent } from "react";

import { useTags } from "@/hooks/use-tags";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

import { useUpdateTagsMutation } from "./mutations/tag-mention-mutation";

const tagVariants: Variants = {
  animate: {
    opacity: 1,
    scale: 1,
    transition: {
      damping: 20,
      stiffness: 200,
      type: "spring",
    },
    y: 0,
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: {
      duration: 0.2,
    },
    y: -10,
  },
  initial: { opacity: 0, scale: 0.9, y: -10 },
};

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

interface TagEditorProps {
  initialTags: string[];
  onCloseAction: () => void;
  onTagsUpdateAction: (tags: Tag[]) => void;
  postId?: string;
}

export const TagEditor = ({
  postId,
  initialTags,
  onCloseAction,
  onTagsUpdateAction,
}: TagEditorProps) => {
  const [search, setSearch] = useState("");
  const { suggestions, searchTags } = useTags(postId);
  const { toast } = useToast();
  const [isFocused, setIsFocused] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const updateTags = useUpdateTagsMutation(postId);

  const handleSelect = useCallback(
    (tagName: string) => {
      if (selectedTags.length >= 5) {
        toast({
          description: "You can add up to 5 tags per post",
          title: "Up to 5 Tags",
          variant: "destructive",
        });
        return;
      }

      if (!selectedTags.includes(tagName)) {
        const newTags = [...selectedTags, tagName.toLowerCase()];
        setSelectedTags(newTags);

        const formattedTags: TagWithCount[] = newTags.map((name) => ({
          _count: {
            posts: 1,
          },
          createdAt: new Date(),
          id: name,
          name: name.toLowerCase(),
          updatedAt: new Date(),
        }));

        onTagsUpdateAction(formattedTags);
      }
      setSearch("");
    },
    [selectedTags, onTagsUpdateAction, toast]
  );

  const handleRemove = useCallback(
    (tagName: string) => {
      const newTags = selectedTags.filter((t) => t !== tagName);
      setSelectedTags(newTags);

      const formattedTags: TagWithCount[] = newTags.map((name) => ({
        _count: {
          posts: 1,
        },
        createdAt: new Date(),
        id: name,
        name: name.toLowerCase(),
        updatedAt: new Date(),
      }));

      onTagsUpdateAction(formattedTags);
    },
    [selectedTags, onTagsUpdateAction]
  );

  const handleSave = useCallback(async () => {
    try {
      const optimisticTags: TagWithCount[] = selectedTags.map((name) => ({
        _count: { posts: 1 },
        createdAt: new Date(),
        id: name,
        name,
        updatedAt: new Date(),
      }));

      onTagsUpdateAction(optimisticTags);
      onCloseAction();

      await updateTags.mutateAsync(selectedTags);
    } catch {
      toast({
        description: "Couldn't save your tags, try again?",
        variant: "destructive",
      });
    }
  }, [selectedTags, onTagsUpdateAction, onCloseAction, updateTags, toast]);

  const handleSearch = useCallback(
    async (value: string) => {
      setSearch(value);
      if (value.trim()) {
        await searchTags(value);
      }
    },
    [searchTags]
  );

  const handleRemoveClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const { tagName } = e.currentTarget.dataset;
      if (tagName !== undefined) {
        handleRemove(tagName);
      }
    },
    [handleRemove]
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  return (
    <div>
      <motion.div
        animate="animate"
        className="space-y-4"
        initial="initial"
        variants={containerVariants}
      >
        {selectedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <AnimatePresence mode="popLayout">
              {selectedTags.map((tagName) => (
                <motion.div
                  className="meta-chip meta-chip-tag"
                  key={tagName}
                  layout
                  variants={tagVariants}
                >
                  <Hash className="meta-chip-accent h-3.5 w-3.5" />
                  <span className="text-xs font-medium">{tagName}</span>
                  <button
                    aria-label={`Remove tag ${tagName}`}
                    className="meta-chip-accent text-muted-foreground hover:text-destructive flex h-4 w-4 items-center justify-center rounded-full transition-colors"
                    data-tag-name={tagName}
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

        <div
          className={cn(
            "relative transition-all duration-200",
            isFocused && "ring-0"
          )}
        >
          <Command className="premium-command overflow-hidden">
            <div className="flex items-center px-3">
              <Search className="text-muted-foreground mr-2 h-4 w-4 shrink-0" />
              <Command.Input
                className="placeholder:text-muted-foreground/70 h-9 flex-1 border-0 bg-transparent text-sm outline-hidden focus:ring-0"
                onBlur={handleBlur}
                onFocus={handleFocus}
                onValueChange={handleSearch}
                placeholder="Search tags or create new..."
                value={search}
              />
            </div>
            <Command.List className="max-h-45 overflow-y-auto p-1.5">
              {search && !suggestions?.includes(search) && (
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
              {suggestions && suggestions.length > 0
                ? suggestions.map((tagName: string) => (
                    <Command.Item
                      className="pill-3d-hover group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm"
                      key={tagName}
                      onSelect={handleSelect}
                      value={tagName}
                    >
                      <Hash className="text-primary/70 group-hover:text-primary h-4 w-4 transition-colors" />
                      <span className="font-medium">{tagName}</span>
                    </Command.Item>
                  ))
                : search && (
                    <p className="text-muted-foreground p-2 text-sm">
                      No tags found. Type to create a new one.
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
            disabled={updateTags.isPending}
            onClick={handleSave}
          >
            {updateTags.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
