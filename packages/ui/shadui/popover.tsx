"use client";

import {
  Anchor,
  Content,
  Portal,
  Root,
  Trigger,
} from "@radix-ui/react-popover";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const Popover = Root;

const PopoverTrigger = Trigger;

const PopoverAnchor = Anchor;

const PopoverContent = ({
  className,
  align = "center",
  sideOffset = 4,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.Ref<ElementRef<typeof Content> | null>;
}) => (
  <Portal>
    <Content
      align={align}
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 panel-3d text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in z-50 w-72 origin-center rounded-2xl! p-4 outline-hidden duration-200 motion-reduce:animate-none!",
        className
      )}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </Portal>
);
PopoverContent.displayName = Content.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
