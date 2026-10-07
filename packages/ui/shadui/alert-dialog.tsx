"use client";

import {
  Action,
  Cancel,
  Content,
  Description,
  Overlay,
  Portal,
  Root,
  Title,
  Trigger,
} from "@radix-ui/react-alert-dialog";
import type * as React from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";
import type { ButtonProps } from "./button";

const AlertDialog = Root;

const AlertDialogTrigger = Trigger;

const AlertDialogPortal = Portal;

const AlertDialogOverlay = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Overlay> & {
  ref?: React.Ref<React.ElementRef<typeof Overlay> | null>;
}) => (
  <Overlay
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in fixed inset-0 z-50 bg-black/80",
      className
    )}
    {...props}
    ref={ref}
  />
);
AlertDialogOverlay.displayName = Overlay.displayName;

const AlertDialogContent = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.Ref<React.ElementRef<typeof Content> | null>;
}) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <Content
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] panel-3d data-[state=closed]:animate-out data-[state=open]:animate-in fixed top-[50%] left-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-2xl! p-4 duration-200 sm:p-5",
        className
      )}
      ref={ref}
      {...props}
    />
  </AlertDialogPortal>
);
AlertDialogContent.displayName = Content.displayName;

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-2 text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Title> & {
  ref?: React.Ref<React.ElementRef<typeof Title> | null>;
}) => (
  <Title
    className={cn("text-lg font-semibold", className)}
    ref={ref}
    {...props}
  />
);
AlertDialogTitle.displayName = Title.displayName;

const AlertDialogDescription = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Description> & {
  ref?: React.Ref<React.ElementRef<typeof Description> | null>;
}) => (
  <Description
    className={cn("text-muted-foreground text-sm", className)}
    ref={ref}
    {...props}
  />
);
AlertDialogDescription.displayName = Description.displayName;

const AlertDialogAction = ({
  className,
  variant = "premium",
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Action> & {
  variant?: ButtonProps["variant"];
  ref?: React.Ref<React.ElementRef<typeof Action> | null>;
}) => (
  <Action
    className={cn(buttonVariants({ variant }), className)}
    ref={ref}
    {...props}
  />
);
AlertDialogAction.displayName = Action.displayName;

const AlertDialogCancel = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Cancel> & {
  ref?: React.Ref<React.ElementRef<typeof Cancel> | null>;
}) => (
  <Cancel
    className={cn(buttonVariants({ variant: "outline" }), className)}
    ref={ref}
    {...props}
  />
);
AlertDialogCancel.displayName = Cancel.displayName;

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
