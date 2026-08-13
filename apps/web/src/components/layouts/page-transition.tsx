"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";

// Cross-fades between pages on client-side navigation so route changes don't
// hard-cut. The Next.js loading.tsx fallback (which also fades) covers the
// initial fetch; this covers subsequent navigations.
export default function PageTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        initial={{ opacity: 0, y: 6 }}
        key={pathname}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
