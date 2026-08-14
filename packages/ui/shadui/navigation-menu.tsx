import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Content,
  Indicator,
  Item,
  Link,
  List,
  Root,
  Trigger,
  Viewport,
} from "@radix-ui/react-navigation-menu";
import { cva } from "class-variance-authority";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const NavigationMenu = ({
  className,
  children,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn(
      "relative z-10 flex max-w-max flex-1 items-center justify-center",
      className
    )}
    ref={ref}
    {...props}
  >
    {children}
    <NavigationMenuViewport />
  </Root>
);
NavigationMenu.displayName = Root.displayName;

const NavigationMenuList = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof List> & {
  ref?: React.Ref<ElementRef<typeof List> | null>;
}) => (
  <List
    className={cn(
      "group flex flex-1 list-none items-center justify-center space-x-1",
      className
    )}
    ref={ref}
    {...props}
  />
);
NavigationMenuList.displayName = List.displayName;

const NavigationMenuItem = Item;

const navigationMenuTriggerStyle = cva(
  "group bg-background hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[active]:bg-accent/50 data-[state=open]:bg-accent/50 inline-flex h-9 w-max items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-hidden disabled:pointer-events-none disabled:opacity-50"
);

const NavigationMenuTrigger = ({
  className,
  children,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Trigger> & {
  ref?: React.Ref<ElementRef<typeof Trigger> | null>;
}) => (
  <Trigger
    className={cn(navigationMenuTriggerStyle(), "group", className)}
    ref={ref}
    {...props}
  >
    {children}{" "}
    <ChevronDownIcon
      aria-hidden="true"
      className="relative top-[1px] ml-1 h-3 w-3 transition duration-300 group-data-[state=open]:rotate-180"
    />
  </Trigger>
);
NavigationMenuTrigger.displayName = Trigger.displayName;

const NavigationMenuContent = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.Ref<ElementRef<typeof Content> | null>;
}) => (
  <Content
    className={cn(
      "data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out top-0 left-0 w-full md:absolute md:w-auto",
      className
    )}
    ref={ref}
    {...props}
  />
);
NavigationMenuContent.displayName = Content.displayName;

const NavigationMenuLink = Link;

const NavigationMenuViewport = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Viewport> & {
  ref?: React.Ref<ElementRef<typeof Viewport> | null>;
}) => (
  <div className={cn("absolute top-full left-0 flex justify-center")}>
    <Viewport
      className={cn(
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 origin-top-center bg-popover text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border shadow-sm md:w-[var(--radix-navigation-menu-viewport-width)]",
        className
      )}
      ref={ref}
      {...props}
    />
  </div>
);
NavigationMenuViewport.displayName = Viewport.displayName;

const NavigationMenuIndicator = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Indicator> & {
  ref?: React.Ref<ElementRef<typeof Indicator> | null>;
}) => (
  <Indicator
    className={cn(
      "data-[state=hidden]:fade-out data-[state=visible]:fade-in data-[state=hidden]:animate-out data-[state=visible]:animate-in top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden",
      className
    )}
    ref={ref}
    {...props}
  >
    <div className="bg-border relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm shadow-md" />
  </Indicator>
);
NavigationMenuIndicator.displayName = Indicator.displayName;

export {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
};
