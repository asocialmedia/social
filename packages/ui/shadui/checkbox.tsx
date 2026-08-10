"use client";

import { Indicator, Root } from "@radix-ui/react-checkbox";
import type * as React from "react";
import { cn } from "../lib/utils";

const Checkbox = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<React.ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn(
      "premium-checkbox flex shrink-0 items-center justify-center focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    {...props}
  >
    <Indicator className="flex items-center justify-center" />
  </Root>
);
Checkbox.displayName = Root.displayName;

export { Checkbox };
