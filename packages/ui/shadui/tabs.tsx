"use client";

import { Content, List, Root, Trigger } from "@radix-ui/react-tabs";
import type * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "../lib/utils";

const Tabs = Root;

const TabsList = ({
  appearance = "default",
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof List> & {
  appearance?: "default" | "raised";
  ref?: React.Ref<ElementRef<typeof List> | null>;
}) => (
  <List
    className={cn(
      "text-muted-foreground inline-flex h-9 items-center justify-center rounded-lg p-1",
      appearance === "raised" ? "surface-3d" : "bg-muted",
      className
    )}
    ref={ref}
    {...props}
  />
);
TabsList.displayName = List.displayName;

const TabsTrigger = ({
  appearance = "default",
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Trigger> & {
  appearance?: "default" | "raised";
  ref?: React.Ref<ElementRef<typeof Trigger> | null>;
}) => (
  <Trigger
    className={cn(
      "ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
      appearance === "raised"
        ? "tabs-segment-3d hover:text-foreground duration-200 motion-reduce:transition-none"
        : "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    ref={ref}
    {...props}
  />
);
TabsTrigger.displayName = Trigger.displayName;

const TabsContent = ({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.Ref<ElementRef<typeof Content> | null>;
}) => (
  <Content
    className={cn(
      "ring-offset-background focus-visible:ring-ring mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
      className
    )}
    ref={ref}
    {...props}
  />
);
TabsContent.displayName = Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
