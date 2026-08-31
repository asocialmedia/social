"use client";

import { TabsTrigger } from "@asm/ui/shadui/tabs";
import { motion } from "motion/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

// Same treatment as TAB_TRIGGER_CLASS but without the static after: underline:
// the active indicator is a motion.span that springs between tabs via layoutId,
// so switching tabs animates the underline sliding across instead of popping.
const ANIMATED_TRIGGER_CLASS =
  "relative inline-flex h-full items-center justify-center rounded-none border-0 px-3 py-3 font-medium text-muted-foreground text-sm outline-none transition-all duration-200 ease-out hover:bg-gradient-to-b hover:from-[#e4e7ec] hover:to-[#c6ccd5] hover:text-[#1c1f26] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.9),0_0_0_1px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06)] dark:hover:from-[#8f96a3] dark:hover:to-[#5c6370] dark:hover:text-white dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] data-[state=active]:px-8 data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:hover:bg-none data-[state=active]:hover:from-none data-[state=active]:hover:to-none data-[state=active]:hover:shadow-none data-[state=active]:hover:text-foreground";

interface AnimatedTabTriggerProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsTrigger>,
  "className"
> {
  active: boolean;
  className?: string;
  layoutId: string;
}

export function AnimatedTabTrigger({
  active,
  className,
  layoutId,
  children,
  ...props
}: AnimatedTabTriggerProps) {
  return (
    <TabsTrigger className={cn(ANIMATED_TRIGGER_CLASS, className)} {...props}>
      {active ? (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0 flex justify-center"
          layoutId={layoutId}
          transition={{
            damping: 34,
            stiffness: 420,
            type: "spring",
          }}
        >
          <span className="h-1 w-6 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]" />
        </motion.span>
      ) : null}
      <span className="relative z-10 flex items-center gap-1.5">
        {children}
      </span>
    </TabsTrigger>
  );
}

// Plain-button variant for tab groups that are driven by local state instead
// of Radix Tabs (e.g. the notifications All/Mentions switch). Same sliding
// underline via layoutId.
interface AnimatedTabButtonProps {
  active: boolean;
  className?: string;
  layoutId: string;
  onClick: () => void;
  children: ReactNode;
}

export function AnimatedTabButton({
  active,
  children,
  className,
  layoutId,
  onClick,
}: AnimatedTabButtonProps) {
  return (
    <button
      className={cn(ANIMATED_TRIGGER_CLASS, className)}
      data-state={active ? "active" : "inactive"}
      onClick={onClick}
      type="button"
    >
      {active ? (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0 flex justify-center"
          layoutId={layoutId}
          transition={{
            damping: 34,
            stiffness: 420,
            type: "spring",
          }}
        >
          <span className="h-1 w-6 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]" />
        </motion.span>
      ) : null}
      <span className="relative z-10 flex items-center gap-1.5">
        {children}
      </span>
    </button>
  );
}
