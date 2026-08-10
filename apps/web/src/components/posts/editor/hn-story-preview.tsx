"use client";

import type { HNStoryType } from "@asm/ui/components";
import { Badge } from "@asm/ui/shadui/badge";
import { Card } from "@asm/ui/shadui/card";
import {
  ExternalLink,
  Link,
  MessageCircle,
  ThumbsUp,
  User,
  X,
} from "lucide-react";
import { motion } from "motion/react";

interface HnStoryPreviewProps {
  onRemoveAction: () => void;
  story: HNStoryType;
}

export function HNStoryPreview({ story, onRemoveAction }: HnStoryPreviewProps) {
  const domain = story.url ? new URL(story.url).hostname : null;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="relative mb-4"
      initial={{ opacity: 0, y: 20 }}
    >
      <Card className="overflow-hidden border-orange-500/20 bg-muted/30 p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center">
            <div className="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 font-bold text-white text-xs">
              Y
            </div>
            <span className="text-muted-foreground text-xs">Hacker News</span>
          </div>
          <button
            className="rounded-full p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={onRemoveAction}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2">
          <a
            className="font-medium hover:text-orange-500"
            href={
              story.url || `https://news.ycombinator.com/item?id=${story.id}`
            }
            rel="noopener noreferrer"
            target="_blank"
          >
            {story.title}
          </a>

          {domain && (
            <div className="mt-1">
              <Badge
                className="text-xs hover:bg-orange-500/10 hover:text-orange-500"
                variant="secondary"
              >
                <Link className="mr-1 h-3 w-3" />
                {domain}
              </Badge>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
          <div className="flex items-center gap-1">
            <User className="h-3 w-3" />
            <span>{story.by}</span>
          </div>

          <div className="flex items-center gap-1">
            <ThumbsUp className="h-3 w-3" />
            <span>{story.score} points</span>
          </div>

          <div className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            <span>{story.descendants} comments</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            <a
              className="hover:text-orange-500"
              href={
                story.url || `https://news.ycombinator.com/item?id=${story.id}`
              }
              rel="noopener noreferrer"
              target="_blank"
            >
              View original
            </a>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
