"use client";

import { Button } from "@asm/ui/shadui/button";
import { ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useId } from "react";

interface ScrollUpButtonProps {
  isVisible: boolean;
}

const ScrollUpButton: React.FC<ScrollUpButtonProps> = ({ isVisible }) => {
  const circleId = useId();

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed right-4 bottom-20 z-50">
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        initial={{ opacity: 0, scale: 0.5 }}
        transition={{ duration: 0.3 }}
      >
        <Button
          className="group relative h-16 w-16 overflow-hidden rounded-full bg-primary p-2 transition-all duration-300 hover:bg-primary/90"
          onClick={scrollToTop}
          size="icon"
          variant="outline"
        >
          <ArrowUp className="absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 transform text-primary-foreground transition-all duration-300 group-hover:translate-y-[-200%]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              initial={{ rotate: 0 }}
              transition={{
                duration: 10,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            >
              {/* biome-ignore lint/a11y/noSvgWithoutTitle: no need */}
              <svg className="h-full w-full" viewBox="0 0 100 100">
                <defs>
                  <path
                    d="M 50, 50 m -37, 0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0"
                    id={circleId}
                  />
                </defs>
                <text className="fill-primary-foreground font-semibold text-xs uppercase">
                  <textPath xlinkHref={`#${circleId}`}>
                    Scroll Up • Scroll Up • Scroll Up •
                  </textPath>
                </text>
              </svg>
            </motion.div>
          </div>
        </Button>
      </motion.div>
    </div>
  );
};

export default ScrollUpButton;
