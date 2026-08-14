"use client";

import { Button } from "@asm/ui/shadui/button";
import { ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useId } from "react";

interface ScrollUpButtonProps {
  isVisible: boolean;
}

function scrollToTop() {
  window.scrollTo({ behavior: "smooth", top: 0 });
}

const ScrollUpButton: React.FC<ScrollUpButtonProps> = ({ isVisible }) => {
  const circleId = useId();

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
          className="group bg-primary hover:bg-primary/90 relative h-16 w-16 overflow-hidden rounded-full p-2 transition-all duration-300"
          onClick={scrollToTop}
          size="icon"
          variant="outline"
        >
          <ArrowUp className="text-primary-foreground absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 transform transition-all duration-300 group-hover:translate-y-[-200%]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              initial={{ rotate: 0 }}
              transition={{
                duration: 10,
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
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
                <text className="fill-primary-foreground text-xs font-semibold uppercase">
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
