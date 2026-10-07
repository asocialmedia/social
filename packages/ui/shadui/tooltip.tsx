"use client";

import {
  Content,
  Portal,
  Provider,
  Root,
  Trigger,
} from "@radix-ui/react-tooltip";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const TooltipProvider = Provider;

const Tooltip = Root;

const TooltipTrigger = Trigger;

const TooltipContent = ({
  className,
  sideOffset = 4,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.Ref<ElementRef<typeof Content> | null>;
}) => (
  <Portal>
    <Content
      className={cn(
        "fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 animate-in panel-3d text-foreground data-[state=closed]:animate-out z-50 origin-center overflow-hidden rounded-md px-3 py-1.5 text-xs duration-200 motion-reduce:animate-none!",
        className
      )}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </Portal>
);
TooltipContent.displayName = Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
