"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { type MouseEvent as ReactMouseEvent, useCallback } from "react";

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
        <span className="relative z-10 text-primary text-sm transition-colors duration-300 group-hover:text-primary">
          {text}
        </span>

        <motion.span
          className="absolute bottom-0 left-0 h-px w-full bg-primary/50"
          initial={{ scaleX: 0, originX: 0 }}
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
