"use client";

import type { CommunityCreationQuota } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import { Info } from "lucide-react";

import CommunityCreationGate from "@/components/communities/community-creation-gate";
import { cn } from "@/lib/utils";

// A filled plus, not Lucide's stroke-only `Plus`: the glyph is drawn as real
// geometry so a solid fill actually renders.
function FilledPlus() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <rect height="18" rx="3" width="6" x="9" y="3" />
      <rect height="6" rx="3" width="18" x="3" y="9" />
    </svg>
  );
}

// The create action for every screen where the right rail is not (mobile and
// the lg-to-xl gap). It renders nothing when the account has not cleared the
// aura gate - the companion `CommunityCreationInfo` stands in its place, so the
// reader is told why rather than shown a dead button.
export function CommunityCreateButton({
  className,
  onCreate,
  quota,
}: {
  className?: string;
  onCreate: () => void;
  quota: CommunityCreationQuota | undefined;
}) {
  // Truthiness narrows `quota`; a separate boolean would leave it `| undefined`.
  if (quota && !quota.canCreate) {
    return null;
  }

  return (
    <Button
      className={cn("h-10 w-full max-w-xs rounded-lg text-[15px]", className)}
      onClick={onCreate}
      type="button"
      variant="premium"
    >
      <FilledPlus />
      Create community
    </Button>
  );
}

// The (i) that replaces the button when the aura gate is unmet. Touch has no
// hover, so the gate opens on tap rather than in a tooltip. Renders nothing for
// an eligible account or while the quota is still loading.
export function CommunityCreationInfo({
  className,
  quota,
}: {
  className?: string;
  quota: CommunityCreationQuota | undefined;
}) {
  if (!quota || quota.canCreate) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Why can't I create a community?"
          className={cn(
            "icon-btn-3d flex size-8 shrink-0 items-center justify-center",
            className
          )}
          type="button"
        >
          <Info className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3.5" side="bottom">
        <CommunityCreationGate quota={quota} />
      </PopoverContent>
    </Popover>
  );
}
