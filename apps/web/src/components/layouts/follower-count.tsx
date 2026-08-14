"use client";

import { Users } from "lucide-react";
import { motion } from "motion/react";

import { formatNumber } from "@/lib/utils";

interface FollowerCountProps {
  initialState: { followers: number; isFollowedByUser: boolean };
  onClick?: () => void;
  userId: string;
}

export default function FollowerCount({
  initialState,
  onClick,
}: FollowerCountProps) {
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
        <Users className="text-primary group-hover:text-primary/80 h-4 w-4" />
      </motion.div>
      <span>
        <span className="font-semibold">
          {formatNumber(initialState.followers)}
        </span>{" "}
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          Followers
        </span>
      </span>
    </motion.button>
  );
}
