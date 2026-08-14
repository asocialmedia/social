"use client";

import {
  Corner,
  Root,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  Viewport,
} from "@radix-ui/react-scroll-area";
import type * as React from "react";

import { cn } from "../lib/utils";

const ScrollArea = ({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<React.ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn("relative overflow-hidden", className)}
    ref={ref}
    {...props}
  >
    <Viewport className="h-full w-full rounded-[inherit]">{children}</Viewport>
    <ScrollBar />
    <Corner />
  </Root>
);
ScrollArea.displayName = Root.displayName;

const ScrollBar = ({
  className,
  orientation = "vertical",
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaScrollbar> & {
  ref?: React.Ref<React.ElementRef<typeof ScrollAreaScrollbar> | null>;
}) => (
  <ScrollAreaScrollbar
    className={cn(
      "flex touch-none transition-colors select-none",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    orientation={orientation}
    ref={ref}
    {...props}
  >
    <ScrollAreaThumb className="bg-border relative flex-1 rounded-full" />
  </ScrollAreaScrollbar>
);
ScrollBar.displayName = ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
