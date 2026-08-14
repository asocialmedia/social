"use client";

import { Fallback, Image, Root } from "@radix-ui/react-avatar";
import type * as React from "react";

import { cn } from "../lib/utils";

const Avatar = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Root> & {
  ref?: React.Ref<React.ElementRef<typeof Root> | null>;
}) => (
  <Root
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    ref={ref}
    {...props}
  />
);
Avatar.displayName = Root.displayName;

const AvatarImage = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Image> & {
  ref?: React.Ref<React.ElementRef<typeof Image> | null>;
}) => (
  <Image
    className={cn("aspect-square h-full w-full", className)}
    ref={ref}
    {...props}
  />
);
AvatarImage.displayName = Image.displayName;

const AvatarFallback = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Fallback> & {
  ref?: React.Ref<React.ElementRef<typeof Fallback> | null>;
}) => (
  <Fallback
    className={cn(
      "bg-muted flex h-full w-full items-center justify-center rounded-full",
      className
    )}
    ref={ref}
    {...props}
  />
);
AvatarFallback.displayName = Fallback.displayName;

export { Avatar, AvatarFallback, AvatarImage };
