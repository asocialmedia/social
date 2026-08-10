"use client";

import type { Tag, TagWithCount } from "@asm/db";
import { useToast } from "@asm/ui/hooks/use-toast";
import { Button } from "@asm/ui/shadui/button";
import { Command } from "cmdk";
import { Hash, Loader2, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useState } from "react";
import { useTags } from "@/hooks/use-tags";
import { cn } from "@/lib/utils";
import { useUpdateTagsMutation } from "./mutations/tag-mention-mutation";

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

interface TagEditorProps {
  initialTags: string[];
  onCloseAction: () => void;
  onTagsUpdateAction: (tags: Tag[]) => void;
  postId?: string;
}

export function TagEditor({
  postId,
  initialTags,
  onCloseAction,
  onTagsUpdateAction,
}: TagEditorProps) {
  const [search, setSearch] = useState("");
  const { suggestions, searchTags } = useTags(postId);
  const { toast } = useToast();
  const [isFocused, setIsFocused] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const updateTags = useUpdateTagsMutation(postId);

  const handleSelect = (tagName: string) => {
    if (selectedTags.length >= 5) {
      toast({
        title: "Maximum tags reached",
        description: "You can only add up to 5 tags per post",
        variant: "destructive",
      });
      return;
    }

    if (!selectedTags.includes(tagName)) {
      const newTags = [...selectedTags, tagName.toLowerCase()];
      setSelectedTags(newTags);

      const formattedTags: TagWithCount[] = newTags.map((name) => ({
        id: name,
        name: name.toLowerCase(),
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: {
          posts: 1,
        },
      }));

      onTagsUpdateAction(formattedTags);
    }
    setSearch("");
  };

  const handleRemove = (tagName: string) => {
    const newTags = selectedTags.filter((t) => t !== tagName);
    setSelectedTags(newTags);

    const formattedTags: TagWithCount[] = newTags.map((name) => ({
      id: name,
      name: name.toLowerCase(),
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: {
        posts: 1,
      },
    }));

    onTagsUpdateAction(formattedTags);
  };

  const handleSave = async () => {
    try {
      const optimisticTags: TagWithCount[] = selectedTags.map((name) => ({
        id: name,
        name,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { posts: 1 },
      }));

      onTagsUpdateAction(optimisticTags);
      onCloseAction();

      await updateTags.mutateAsync(selectedTags);
    } catch {
      toast({
        title: "Error",
        description: "Failed to update tags. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSearch = async (value: string) => {
    setSearch(value);
    if (value.trim()) {
      await searchTags(value);
    }
  };

  return (
    <div>
      <motion.div
        animate="animate"
        className="space-y-4"
        initial="initial"
        variants={containerVariants}
      >
        <div className="flex min-h-10 flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {selectedTags.map((tagName) => (
              <motion.div
                className="group flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 backdrop-blur-[2px] transition-colors hover:border-primary/30 hover:bg-primary/15"
                key={tagName}
                layout
                variants={tagVariants}
              >
                <Hash className="h-3.5 w-3.5 text-primary/70" />
                <span className="font-medium text-primary text-sm">
                  {tagName}
                </span>
                <button
                  className="text-primary/50 transition-colors hover:text-primary"
                  onClick={() => handleRemove(tagName)}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div
          className={cn(
            "relative rounded-lg transition-all duration-200",
            isFocused && "ring-2 ring-primary/20 ring-offset-1"
          )}
        >
          <Command className="overflow-hidden rounded-lg bg-muted/50">
            <div className="flex items-center border-border/50 border-b px-3">
              <Search className="mr-2 h-4 w-4 text-muted-foreground" />
              <Command.Input
                className="h-11 flex-1 border-0 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/70 focus:ring-0"
                onBlur={() => setIsFocused(false)}
                onFocus={() => setIsFocused(true)}
                onValueChange={handleSearch}
                placeholder="Search tags or create new..."
                value={search}
              />
            </div>
            <Command.List className="max-h-45 overflow-y-auto p-2">
              {search && !suggestions?.includes(search) && (
                <Command.Item
                  className="group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm hover:bg-accent"
                  onSelect={handleSelect}
                  value={search}
                >
                  <Plus className="h-4 w-4 text-primary/70 transition-colors group-hover:text-primary" />
                  <span>
                    Create tag "<span className="font-medium">{search}</span>"
                  </span>
                </Command.Item>
              )}
              {suggestions && suggestions.length > 0
                ? suggestions.map((tagName: string) => (
                    <Command.Item
                      className="group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm hover:bg-accent"
                      key={tagName}
                      onSelect={handleSelect}
                      value={tagName}
                    >
                      <Hash className="h-4 w-4 text-primary/70 transition-colors group-hover:text-primary" />
                      <span className="font-medium">{tagName}</span>
                    </Command.Item>
                  ))
                : search && (
                    <p className="p-2 text-muted-foreground text-sm">
                      No tags found. Type to create a new one.
                    </p>
                  )}
            </Command.List>
          </Command>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            className="hover:bg-destructive/10 hover:text-destructive"
            onClick={onCloseAction}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="min-w-20 bg-primary text-primary-foreground hover:bg-primary/90"
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
}
