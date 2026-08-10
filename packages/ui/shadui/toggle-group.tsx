"use client";

import { toggleVariants } from "@asm/ui/shadui/toggle";
import { Item, Root } from "@radix-ui/react-toggle-group";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import {
  type ComponentPropsWithoutRef,
  createContext,
  type ElementRef,
  useContext,
} from "react";
import { cn } from "../lib/utils";

const ToggleGroupContext = createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

const ToggleGroup = ({
  className,
  variant,
  size,
  children,
  ref,
  ...props
}: (ComponentPropsWithoutRef<typeof Root> &
  VariantProps<typeof toggleVariants>) & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn("flex items-center justify-center gap-1", className)}
    ref={ref}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </Root>
);

ToggleGroup.displayName = Root.displayName;

const ToggleGroupItem = ({
  className,
  children,
  variant,
  size,
  ref,
  ...props
}: (ComponentPropsWithoutRef<typeof Item> &
  VariantProps<typeof toggleVariants>) & {
  ref?: React.Ref<ElementRef<typeof Item> | null>;
}) => {
  const context = useContext(ToggleGroupContext);

  return (
    <Item
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </Item>
  );
};

ToggleGroupItem.displayName = Item.displayName;

export { ToggleGroup, ToggleGroupItem };
