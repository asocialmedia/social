"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";

import { cn } from "@/lib/utils";

export function BlueskyIcon({
  className,
  tooltip = true,
}: {
  className?: string;
  tooltip?: boolean;
}) {
  const icon = <BlueskyMark className={className} />;
  if (!tooltip) {
    return icon;
  }
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label="From Bluesky"
            className="inline-flex shrink-0 items-center"
          >
            {icon}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          This person and their posts come from Bluesky. asocialmedia
          interactions stay on asocialmedia.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BlueskyMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-sky-500", className)}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        d="M5.1 3.6C7.9 5.7 10.9 10 12 12.3c1.1-2.3 4.1-6.6 6.9-8.7 2-1.5 5.1-2.6 5.1 1.2 0 .8-.4 6.8-.7 7.8-1 3.4-4.5 4.3-7.6 3.8 5.4.9 6.8 3.8 3.8 6.7-5.7 5.8-8.2-1.5-8.9-3.4-.1-.4-.2-.6-.3-.5-.1-.1-.2.1-.3.5-.7 1.9-3.2 9.2-8.9 3.4-3-2.9-1.6-5.8 3.8-6.7-3.1.5-6.6-.4-7.6-3.8-.3-1-.7-7-.7-7.8 0-3.8 3.1-2.7 5.1-1.2Z"
        transform="translate(2 0) scale(.83)"
      />
    </svg>
  );
}
