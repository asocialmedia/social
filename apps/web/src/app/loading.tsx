"use client";

import { motion } from "motion/react";
import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";

export default function Loading() {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-label="Page is loading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      initial={{ opacity: 0 }}
      role="status"
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <CenteredLogoLoader size={64} />
    </motion.div>
  );
}
