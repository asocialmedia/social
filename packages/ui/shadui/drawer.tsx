"use client";

import type * as React from "react";
import type {
  ComponentProps,
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "../lib/utils";

const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root
    shouldScaleBackground={shouldScaleBackground}
    {...props}
  />
);
Drawer.displayName = "Drawer";

const DrawerTrigger = DrawerPrimitive.Trigger;

const DrawerPortal = DrawerPrimitive.Portal;

const DrawerClose = DrawerPrimitive.Close;

const DrawerHandle = DrawerPrimitive.Handle;

const DrawerOverlay = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay> & {
  ref?: React.Ref<ElementRef<typeof DrawerPrimitive.Overlay> | null>;
}) => (
  <DrawerPrimitive.Overlay
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    ref={ref}
    {...props}
  />
);
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const DrawerContent = ({
  className,
  children,
  showHandle = true,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
  ref?: React.Ref<ElementRef<typeof DrawerPrimitive.Content> | null>;
  showHandle?: boolean;
}) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      className={cn(
        "panel-3d fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-2xl!",
        className
      )}
      ref={ref}
      {...props}
    >
      {showHandle ? (
        <div className="bg-muted mx-auto mt-4 h-2 w-[100px] rounded-full" />
      ) : null}
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
);
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Title> & {
  ref?: React.Ref<ElementRef<typeof DrawerPrimitive.Title> | null>;
}) => (
  <DrawerPrimitive.Title
    className={cn(
      "text-lg leading-none font-semibold tracking-tight",
      className
    )}
    ref={ref}
    {...props}
  />
);
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

const DrawerDescription = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Description> & {
  ref?: React.Ref<ElementRef<typeof DrawerPrimitive.Description> | null>;
}) => (
  <DrawerPrimitive.Description
    className={cn("text-muted-foreground text-sm", className)}
    ref={ref}
    {...props}
  />
);
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
