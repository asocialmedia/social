"use client";

import { DotFilledIcon } from "@radix-ui/react-icons";
import { Indicator, Item, Root } from "@radix-ui/react-radio-group";
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

const RadioGroupItem = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Item> & {
  ref?: React.Ref<ElementRef<typeof Item> | null>;
}) => (
  <Item
    className={cn(
      "border-primary text-primary focus-visible:ring-ring aspect-square h-4 w-4 rounded-full border shadow-sm focus:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    {...props}
  >
    <Indicator className="flex items-center justify-center">
      <DotFilledIcon className="fill-primary h-3.5 w-3.5" />
    </Indicator>
  </Item>
);
RadioGroupItem.displayName = Item.displayName;

export { RadioGroup, RadioGroupItem };
