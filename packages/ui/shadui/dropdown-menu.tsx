"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  CheckIcon,
  ChevronRightIcon,
  DotFilledIcon,
} from "@radix-ui/react-icons";
import type * as React from "react";

import { cn } from "../lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = ({
  className,
  inset,
  children,
  ref,
  ...props
}: (React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) & {
  ref?: React.Ref<React.ElementRef<
    typeof DropdownMenuPrimitive.SubTrigger
  > | null>;
}) => (
  <DropdownMenuPrimitive.SubTrigger
    className={cn(
      "focus:bg-accent data-[state=open]:bg-accent flex min-h-11 cursor-default items-center gap-2 rounded-lg px-2 py-2 text-sm outline-hidden select-none sm:min-h-9 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    ref={ref}
    {...props}
  >
    {children}
    <ChevronRightIcon className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
);
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & {
  ref?: React.Ref<React.ElementRef<
    typeof DropdownMenuPrimitive.SubContent
  > | null>;
}) => (
  <DropdownMenuPrimitive.SubContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 panel-3d text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in z-50 min-w-[8rem] origin-center overflow-hidden rounded-2xl! p-2 duration-200 motion-reduce:animate-none!",
      className
    )}
    ref={ref}
    {...props}
  />
);
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = ({
  className,
  sideOffset = 4,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
  ref?: React.Ref<React.ElementRef<
    typeof DropdownMenuPrimitive.Content
  > | null>;
}) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      className={cn(
        // Rounded corners are part of the base recipe: without them the panel's
        // `overflow-hidden` clipped the menu to square corners. Declared here so
        // every dropdown matches, not per call site.
        "panel-3d text-popover-foreground z-50 min-w-[8rem] overflow-hidden rounded-2xl! p-2",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=open]:animate-in origin-center duration-200 motion-reduce:animate-none!",
        className
      )}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
);
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = ({
  className,
  inset,
  ref,
  ...props
}: (React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
}) & {
  ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.Item> | null>;
}) => (
  <DropdownMenuPrimitive.Item
    className={cn(
      "focus:bg-accent focus:text-accent-foreground relative flex min-h-11 cursor-default items-center gap-2 rounded-lg px-2 py-2 text-sm outline-hidden transition-colors select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 sm:min-h-9 [&>svg]:size-4 [&>svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    ref={ref}
    {...props}
  />
);
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = ({
  className,
  children,
  checked,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & {
  ref?: React.Ref<React.ElementRef<
    typeof DropdownMenuPrimitive.CheckboxItem
  > | null>;
}) => (
  <DropdownMenuPrimitive.CheckboxItem
    checked={checked}
    className={cn(
      "focus:bg-accent focus:text-accent-foreground relative flex min-h-11 cursor-default items-center rounded-lg py-2 pr-2 pl-8 text-sm outline-hidden transition-colors select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 sm:min-h-9",
      className
    )}
    ref={ref}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <CheckIcon className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
);
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = ({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & {
  ref?: React.Ref<React.ElementRef<
    typeof DropdownMenuPrimitive.RadioItem
  > | null>;
}) => (
  <DropdownMenuPrimitive.RadioItem
    className={cn(
      "focus:bg-accent focus:text-accent-foreground relative flex min-h-11 cursor-default items-center rounded-lg py-2 pr-2 pl-8 text-sm outline-hidden transition-colors select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 sm:min-h-9",
      className
    )}
    ref={ref}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <DotFilledIcon className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
);
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = ({
  className,
  inset,
  ref,
  ...props
}: (React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) & {
  ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.Label> | null>;
}) => (
  <DropdownMenuPrimitive.Label
    className={cn(
      "px-2 py-2 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    ref={ref}
    {...props}
  />
);
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator> & {
  ref?: React.Ref<React.ElementRef<
    typeof DropdownMenuPrimitive.Separator
  > | null>;
}) => (
  <DropdownMenuPrimitive.Separator
    className={cn("bg-muted -mx-1 my-1 h-px", className)}
    ref={ref}
    {...props}
  />
);
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
    {...props}
  />
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
