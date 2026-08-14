"use client";

import { UserPlus } from "lucide-react";
import { motion } from "motion/react";

import { formatNumber } from "@/lib/utils";

interface FollowingCountProps {
  count: number;
  onClick?: () => void;
}

export default function FollowingCount({
  count,
  onClick,
}: FollowingCountProps) {
  return (
    <motion.button
      className="group hover:bg-accent/50 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div
        initial={{ rotate: 0 }}
        transition={{ damping: 10, stiffness: 400, type: "spring" }}
        whileHover={{ rotate: 10 }}
      >
        <UserPlus className="text-primary group-hover:text-primary/80 h-4 w-4" />
      </motion.div>
      <span>
        <span className="font-semibold">{formatNumber(count)}</span>{" "}
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          Following
        </span>
      </span>
    </motion.button>
  );
}
