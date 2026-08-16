"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

// Slides the top bar (logo/avatar row) up out of view when the feed is scrolled
// down, leaving only the tab switcher sticky; returns it on scroll up. The
// tabs row below this component stays pinned because it lives outside the
// scroll container.
export function CollapsibleTopBar({
  children,
  hidden,
}: {
  children: ReactNode;
  hidden: boolean;
}) {
  return (
    <motion.div
      animate={{
        height: hidden ? 0 : "auto",
        opacity: hidden ? 0 : 1,
      }}
      className="overflow-hidden"
      initial={false}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
