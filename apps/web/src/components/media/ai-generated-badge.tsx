// AI-generated marker shown over media surfaces (post cards, gusts, the
// media viewer). The flag comes from Media.aiGenerated, recorded by the
// scan stage's C2PA provenance inspection and stored server-side - so it
// cannot be stripped by editing the file's metadata.
//
// Styling follows the app's dual-border 3D language (inset white ring +
// gloss, outer dark ring, drop shadow) using the violet accent reserved
// for special labels, so it reads as distinct from the orange action
// buttons while staying unmistakably part of the system.

import type { Media } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import noMessageImage from "@assets/general/nomessage.png";
import { Sparkles } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

interface AiGeneratedBadgeProps {
  /** Positioning classes from the host surface (absolute placement etc.). */
  className?: string;
  media: Pick<Media, "aiGenerated">;
}

export function AiGeneratedBadge({ className, media }: AiGeneratedBadgeProps) {
  if (!media.aiGenerated) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            aria-label="AI-generated content"
            className={cn(
              "flex h-6 cursor-help items-center gap-1 rounded-full bg-linear-to-b from-[#7c5cff] to-[#5a3ae0] px-2 text-white select-none",
              "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.25)]",
              className
            )}
            // status badge overlaid on media; <output> would be wrong semantics here
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- status badge overlaid on the media
            role="status"
          >
            <Sparkles className="h-3 w-3 shrink-0" />
            <span className="text-[10px] leading-none font-bold whitespace-nowrap">
              AI Generated
            </span>
          </div>
        </TooltipTrigger>
        {/* Slate surface + violet dual border keeps it in the badge's family
            instead of the default orange tooltip; the mascot avatar softens
            the message for a general audience. */}
        <TooltipContent
          align="start"
          className={cn(
            "max-w-60 rounded-xl px-1.5 py-2",
            "bg-linear-to-b from-[#3a3f4a] to-[#23262e] text-white",
            "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_2px_6px_rgba(0,0,0,0.35)]"
          )}
          side="top"
        >
          {/* Artwork is natively 1536x1024 (3:2 landscape): size by height
              only so it keeps its true proportions instead of being squeezed
              into a square. */}
          <span className="flex items-center gap-1.5">
            <Image
              alt=""
              aria-hidden
              className="h-11 w-auto shrink-0"
              height={1024}
              src={noMessageImage}
              width={1536}
            />
            <span className="text-xs leading-snug">
              Heads up! This was made with AI, not captured on camera.
            </span>
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
