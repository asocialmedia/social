import { motion } from "motion/react";

import { cn } from "@/lib/utils";

interface AnimatedAsocialmediaTextProps {
  className?: string;
}

export const AnimatedAsocialmediaText = ({
  className,
}: AnimatedAsocialmediaTextProps) => {
  const letters = [..."ZEPHYR."];

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={cn(
        "pointer-events-none z-10 text-4xl font-bold select-none sm:text-6xl",
        className
      )}
      initial={{ opacity: 0 }}
      transition={{ delay: 0.7, duration: 0.8 }}
    >
      <div className="relative flex">
        {letters.map((letter, i) => (
          <motion.span
            animate={{
              opacity: [0, 1, 1, 0.3, 1],
              y: [20, 0, 0, 0, 0],
            }}
            className="text-primary/50"
            initial={{ opacity: 0, y: 20 }}
            key={letter}
            style={{
              display: "inline-block",
              textShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
            }}
            transition={{
              delay: i * 0.1,
              duration: 4,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
              times: [0, 0.2, 0.5, 0.8, 1],
            }}
          >
            {letter}
          </motion.span>
        ))}
      </div>
      <motion.div
        animate={{
          opacity: [0, 1, 1, 0.3, 0],
          scaleX: [0, 1, 1, 1, 0],
        }}
        className="bg-primary/30 absolute bottom-0 left-0 h-0.5"
        initial={{ scaleX: 0 }}
        style={{ transformOrigin: "left" }}
        transition={{
          duration: 4,
          ease: "easeInOut",
          repeat: Number.POSITIVE_INFINITY,
          times: [0, 0.2, 0.5, 0.8, 1],
        }}
      />
    </motion.div>
  );
};
