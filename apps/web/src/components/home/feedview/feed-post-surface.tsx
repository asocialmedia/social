import { Card, CardContent } from "@asm/ui/shadui/card";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const FEED_POST_ACTION =
  "pill-3d-hover group text-muted-foreground inline-flex h-7 items-center justify-center gap-1 rounded-full border-0 px-1.5 text-xs font-medium active:translate-y-px sm:h-7.5 sm:px-2 sm:text-[13px]";
export function FeedPostSurface({
  children,
  footer,
  rail,
  className,
  contentClassName = "px-4 py-4",
}: {
  children: ReactNode;
  footer?: ReactNode;
  rail?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card
      className={cn(
        "group/post relative rounded-none bg-[hsl(var(--background-alt))] shadow-none",
        className
      )}
    >
      {rail}
      <CardContent
        className={cn(
          "transition-colors duration-150 hover:bg-[hsl(var(--muted))]",
          contentClassName
        )}
      >
        {children}
      </CardContent>
      {footer}
    </Card>
  );
}
