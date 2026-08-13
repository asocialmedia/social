"use client";

import asmLogo from "@assets/asm.png";
import { motion } from "motion/react";
import Image from "next/image";

export function CenteredLogoLoader({ size = 56 }: { size?: number }) {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-label="Loading page"
      aria-live="polite"
      className="flex w-full items-center justify-center py-16"
      initial={{ opacity: 0 }}
      role="status"
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        className="relative"
        style={{ height: size, width: size }}
        transition={{
          duration: 1.4,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <Image
          alt=""
          className="object-contain"
          fill
          priority
          sizes={`${size}px`}
          src={asmLogo}
        />
      </motion.div>
    </motion.div>
  );
}
