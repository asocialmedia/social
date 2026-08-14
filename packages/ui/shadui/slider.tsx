"use client";

import { Range, Root, Thumb, Track } from "@radix-ui/react-slider";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const Slider = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn(
      "relative flex w-full touch-none items-center select-none",
      className
    )}
    ref={ref}
    {...props}
  >
    <Track className="bg-primary/20 relative h-1.5 w-full grow overflow-hidden rounded-full">
      <Range className="bg-primary absolute h-full" />
    </Track>
    <Thumb className="border-primary/50 bg-background focus-visible:ring-ring block h-4 w-4 rounded-full border shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50" />
  </Root>
);
Slider.displayName = Root.displayName;

export { Slider };
