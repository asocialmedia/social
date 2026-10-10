"use client";

import { Range, Root, Thumb, Track } from "@radix-ui/react-slider";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const Slider = ({
  className,
  ref,
  thumbLabel,
  thumbValueText,
  ...props
}: ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
  // The thumb's accessible name. Radix reads `aria-label` from the THUMB's props
  // and falls back to a positional label ("Value 1 of 2"), so a name has to
  // reach the thumb and not the root. The thumb is a span with role="slider",
  // which is not a labelable element, so a sibling <label htmlFor> cannot name
  // it either. Hence this prop rather than an aria passthrough.
  thumbLabel?: string;
  // The thumb's readable value, e.g. "40%" where `aria-valuenow` alone would
  // read "40". Radix reads `aria-valuetext` from the thumb's props for the same
  // reason `thumbLabel` exists.
  thumbValueText?: string;
}) => (
  <Root
    className={cn(
      "relative flex w-full touch-none items-center select-none",
      className
    )}
    ref={ref}
    {...props}
  >
    <Track className="premium-slider-track relative h-1.5 w-full grow overflow-hidden rounded-full">
      <Range className="premium-slider-range absolute h-full" />
    </Track>
    <Thumb
      aria-label={thumbLabel}
      aria-valuetext={thumbValueText}
      className="premium-slider-thumb focus-visible:ring-ring block h-4 w-4 rounded-full transition-colors focus-visible:ring-1 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
    />
  </Root>
);
Slider.displayName = Root.displayName;

export { Slider };
