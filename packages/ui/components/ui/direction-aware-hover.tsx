"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type * as React from "react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";

function getDirection(
  ev: React.MouseEvent<HTMLDivElement, MouseEvent>,
  obj: HTMLElement
) {
  const { width: w, height: h, left, top } = obj.getBoundingClientRect();
  const x = ev.clientX - left - (w / 2) * (w > h ? h / w : 1);
  const y = ev.clientY - top - (h / 2) * (h > w ? w / h : 1);
  const d = Math.round(Math.atan2(y, x) / 1.57079633 + 5) % 4;
  return d;
}

export const DirectionAwareHover = ({
  imageUrl,
  children,
  childrenClassName,
  imageClassName,
  className,
}: {
  imageUrl: string;
  children: React.ReactNode | string;
  childrenClassName?: string;
  imageClassName?: string;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const [direction, setDirection] = useState<
    "top" | "bottom" | "left" | "right" | string
  >("left");

  const handleMouseEnter = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    if (!ref.current) {
      return;
    }

    const mouseDirection = getDirection(event, ref.current);
    switch (mouseDirection) {
      case 0: {
        setDirection("top");
        break;
      }
      case 1: {
        setDirection("right");
        break;
      }
      case 2: {
        setDirection("bottom");
        break;
      }
      case 3: {
        setDirection("left");
        break;
      }
      default: {
        setDirection("left");
        break;
      }
    }
  };

  return (
    <motion.div
      className={cn(
        "group/card relative h-60 w-60 overflow-hidden rounded-lg bg-transparent md:h-96 md:w-96",
        className
      )}
      onMouseEnter={handleMouseEnter}
      ref={ref}
    >
      <AnimatePresence mode="wait">
        <motion.div
          className="relative h-full w-full"
          exit="exit"
          initial="initial"
          whileHover={direction}
        >
          <motion.div className="absolute inset-0 z-10 hidden h-full w-full bg-black/40 transition duration-500 group-hover/card:block" />
          <motion.div
            className="relative h-full w-full bg-gray-50 dark:bg-black"
            transition={{
              duration: 0.2,
              ease: "easeOut",
            }}
            variants={variants}
          >
            <Image
              alt="image"
              className={cn(
                "h-full w-full scale-[1.15] object-cover",
                imageClassName
              )}
              height="1000"
              src={imageUrl}
              width="1000"
            />
          </motion.div>
          <motion.div
            className={cn(
              "absolute bottom-4 left-4 z-40 text-white",
              childrenClassName
            )}
            transition={{
              duration: 0.5,
              ease: "easeOut",
            }}
            variants={textVariants}
          >
            {children}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
};

const variants = {
  bottom: {
    y: -20,
  },

  exit: {
    x: 0,
    y: 0,
  },

  initial: {
    x: 0,
  },

  left: {
    x: 20,
  },

  right: {
    x: -20,
  },

  top: {
    y: 20,
  },
};

const textVariants = {
  bottom: {
    opacity: 1,
    y: 2,
  },
  exit: {
    opacity: 0,
    x: 0,
    y: 0,
  },
  initial: {
    opacity: 0,
    x: 0,
    y: 0,
  },
  left: {
    opacity: 1,
    x: -2,
  },
  right: {
    opacity: 1,
    x: 20,
  },
  top: {
    opacity: 1,
    y: -20,
  },
};
