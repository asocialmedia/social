"use client";

import { Root } from "@radix-ui/react-toggle";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const toggleVariants = cva(
  "hover:bg-muted hover:text-muted-foreground focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-accent-foreground inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:ring-1 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 min-w-9 px-2",
        lg: "h-10 min-w-10 px-2.5",
        sm: "h-8 min-w-8 px-1.5",
      },
      variant: {
        default: "bg-transparent",
        outline:
          "border-input hover:bg-accent hover:text-accent-foreground border bg-transparent shadow-xs",
      },
    },
  }
);

const Toggle = ({
  className,
  variant,
  size,
  ref,
  ...props
}: (ComponentPropsWithoutRef<typeof Root> &
  VariantProps<typeof toggleVariants>) & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn(toggleVariants({ className, size, variant }))}
    ref={ref}
    {...props}
  />
);

Toggle.displayName = Root.displayName;

export { Toggle, toggleVariants };
