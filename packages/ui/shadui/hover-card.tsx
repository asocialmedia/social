"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import type * as React from "react";

import { cn } from "../lib/utils";

const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = ({
  className,
  align = "center",
  sideOffset = 4,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content> & {
  ref?: React.Ref<React.ElementRef<typeof HoverCardPrimitive.Content> | null>;
}) => (
  // Portal is load-bearing and NOT implied by Content: since Radix 1.1,
  // HoverCardPortal is a separate component that Content no longer wraps
  // itself in (unlike this repo's tooltip/popover wrappers, which do). Without
  // it the content renders inline at the trigger, which breaks any trigger set
  // inside a link or button - nested <a>/<button> is invalid HTML and the
  // parser rewrites it, desyncing the DOM from React's tree.
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      align={align}
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 panel-3d text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in z-50 w-64 origin-center rounded-2xl! p-4 outline-hidden duration-200 motion-reduce:animate-none!",
        className
      )}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </HoverCardPrimitive.Portal>
);
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardContent, HoverCardTrigger };
