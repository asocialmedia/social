import { CornerDownRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function RespondAction({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Respond to this post"
      className="pill-3d-hover group text-muted-foreground inline-flex h-7 items-center justify-center gap-1 rounded-full border-0 px-1.5 text-xs font-medium active:translate-y-px sm:h-7.5 sm:px-2 sm:text-[13px]"
      onClick={onClick}
      type="button"
    >
      <CornerDownRight
        className={cn(
          "size-4 sm:size-4.5",
          count > 0 && "text-foreground stroke-[2.25px]"
        )}
      />
      <span className="text-xs font-medium tabular-nums sm:text-[13px]">
        {count}
      </span>
    </button>
  );
}
