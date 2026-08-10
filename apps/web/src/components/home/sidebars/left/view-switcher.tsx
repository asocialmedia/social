"use client";

import { Grid, List } from "lucide-react";
import { motion } from "motion/react";
import { useCallback } from "react";

interface ViewSwitcherProps {
  onChange: (view: "grid" | "list") => void;
  view: "grid" | "list";
}

export const ViewSwitcher = ({ view, onChange }: ViewSwitcherProps) => {
  const handleListClick = useCallback(() => onChange("list"), [onChange]);
  const handleGridClick = useCallback(() => onChange("grid"), [onChange]);

  return (
    <div className="flex items-center justify-center gap-6">
      {/* biome-ignore lint/a11y/useButtonType: ignore */}
      <button className="group relative pb-1" onClick={handleListClick}>
        <List
          className={`h-4 w-4 transition-colors ${
            view === "list" ? "text-primary" : "text-muted-foreground"
          }`}
        />
        {view === "list" && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute right-0 -bottom-1 left-0 h-[2px] bg-primary"
            initial={{ opacity: 0 }}
            layoutId="viewIndicator"
            transition={{ duration: 0.2 }}
          />
        )}
      </button>

      {/* biome-ignore lint/a11y/useButtonType: ignore */}
      <button className="group relative pb-1" onClick={handleGridClick}>
        <Grid
          className={`h-4 w-4 transition-colors ${
            view === "grid" ? "text-primary" : "text-muted-foreground"
          }`}
        />
        {view === "grid" && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute right-0 -bottom-1 left-0 h-[2px] bg-primary"
            initial={{ opacity: 0 }}
            layoutId="viewIndicator"
            transition={{ duration: 0.2 }}
          />
        )}
      </button>
    </div>
  );
};
