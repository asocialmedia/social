"use client";

import { AnimatePresence, motion } from "motion/react";

interface Requirement {
  text: string;
  validator: (password: string) => boolean;
}

interface PasswordRecommenderProps {
  password: string;
  requirements: Requirement[];
}

export const PasswordRecommender = ({
  password,
  requirements,
}: PasswordRecommenderProps) => {
  if (!password) {
    return null;
  }

  const missingRequirements = requirements.filter(
    (req) => !req.validator(password)
  );

  if (missingRequirements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">Password requirements:</p>
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {missingRequirements.map((req) => (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="text-muted-foreground flex items-center gap-2 text-xs"
              exit={{ opacity: 0, x: 8 }}
              initial={{ opacity: 0, x: -8 }}
              key={req.text}
              transition={{ duration: 0.15 }}
            >
              <span className="bg-muted-foreground/50 size-1 shrink-0 rounded-full" />
              {req.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
