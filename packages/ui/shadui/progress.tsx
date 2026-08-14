"use client";

import { Indicator, Root } from "@radix-ui/react-progress";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const Progress = ({
  className,
  value,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn(
      "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
      className
    )}
    ref={ref}
    {...props}
  >
    <Indicator
      className="bg-primary h-full w-full flex-1 transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </Root>
);
Progress.displayName = Root.displayName;

export { Progress };
