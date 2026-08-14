"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

interface AnimatedAuthLinkProps {
  href: string;
  onSwitch?: () => void;
  text: string;
}

export default function AnimatedAuthLink({
  href,
  text,
  onSwitch,
}: AnimatedAuthLinkProps) {
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (onSwitch) {
        event.preventDefault();
        onSwitch();
      }
    },
    [onSwitch]
  );

  return (
    <Link
      className="group relative inline-block px-2 py-1"
      href={href}
      onClick={handleClick}
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="relative"
        exit={{ opacity: 0, y: -10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{
          duration: 0.3,
          ease: "easeInOut",
        }}
      >
        <span className="text-primary group-hover:text-primary relative z-10 text-sm transition-colors duration-300">
          {text}
        </span>

        <motion.span
          className="bg-primary/50 absolute bottom-0 left-0 h-px w-full"
          initial={{ originX: 0, scaleX: 0 }}
          whileHover={{
            scaleX: 1,
            transition: {
              duration: 0.2,
              ease: "easeOut",
            },
          }}
        />
      </motion.div>
    </Link>
  );
}
