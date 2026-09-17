"use client";

import { Item, Root } from "@radix-ui/react-radio-group";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const RadioGroup = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
}) => <Root className={cn("grid gap-2", className)} {...props} ref={ref} />;
RadioGroup.displayName = Root.displayName;

// Uses the app's tactile control (.premium-radio), the sibling of the checkbox
// recipe: a recessed well that fills with the brand gradient and bevel when
// chosen. The dot is drawn by the class's ::after, so no Indicator is needed.
const RadioGroupItem = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Item> & {
  ref?: React.Ref<ElementRef<typeof Item> | null>;
}) => (
  <Item
    className={cn(
      "premium-radio shrink-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    {...props}
  />
);
RadioGroupItem.displayName = Item.displayName;

export { RadioGroup, RadioGroupItem };
