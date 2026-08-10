import { motion } from "motion/react";
import type { ReactNode } from "react";

interface AuthButtonWrapperProps {
  children: ReactNode;
  className?: string;
}

export default function AuthButtonWrapper({
  children,
  className = "",
}: AuthButtonWrapperProps) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mb-2 w-full"
      initial={{ opacity: 0, y: 20 }}
      transition={{
        duration: 0.3,
        ease: "easeOut",
      }}
    >
      <div
        className={`group relative overflow-hidden rounded-lg backdrop-blur-md transition-all duration-500 ease-in-out ${className}`}
      >
        <div className="relative bg-background/50 transition-colors group-hover:bg-background/70">
          {children}
        </div>
      </div>
    </motion.div>
  );
}
