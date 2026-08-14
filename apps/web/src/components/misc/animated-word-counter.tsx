import { motion } from "motion/react";

import { cn } from "@/lib/utils";

interface AnimatedWordCounterProps {
  current: number;
  max: number;
}

export const AnimatedWordCounter = ({
  current,
  max,
}: AnimatedWordCounterProps) => {
  const percentage = (current / max) * 100;
  const isNearLimit = percentage > 90;
  const isOverLimit = current > max;
  const counterClassName =
    (isOverLimit && "text-destructive") ||
    (isNearLimit && "text-warning") ||
    "text-muted-foreground";

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="relative flex items-center gap-1 text-xs"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        animate={{
          scale: isOverLimit ? [1, 1.1, 1] : 1,
        }}
        className={cn("font-medium", counterClassName)}
        transition={{ duration: 0.2 }}
      >
        {current}
      </motion.div>
      <span className="text-muted-foreground">/</span>
      <span className="text-muted-foreground">{max}</span>

      {isNearLimit && (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="text-warning absolute -top-6 left-0"
          initial={{ opacity: 0, y: 10 }}
        >
          {isOverLimit ? "Too many words" : "Approaching limit"}
        </motion.div>
      )}
    </motion.div>
  );
};
