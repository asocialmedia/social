"use client";

import { Search, X } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type * as React from "react";
import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { Input } from "../../shadui/input";

interface HnSearchInputProps {
  className?: string;
  onChangeAction: (value: string) => void;
  placeholder?: string;
  value: string;
}

const searchVariants: Variants = {
  initial: { scale: 0.95, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 500,
      damping: 30,
    },
  },
  exit: { scale: 0.95, opacity: 0 },
};

export function HNSearchInput({
  value,
  onChangeAction,
  placeholder = "Search stories...",
  className,
}: HnSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleClear = useCallback(() => {
    onChangeAction("");
    inputRef.current?.focus();
  }, [onChangeAction]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChangeAction(e.target.value);
    },
    [onChangeAction]
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  return (
    <motion.div
      animate="animate"
      className={cn("relative", className)}
      exit="exit"
      initial="initial"
      variants={searchVariants}
    >
      <div className="relative flex items-center">
        <motion.div
          animate={{
            scale: isFocused ? 1.1 : 1,
            color: isFocused ? "var(--orange-500)" : "var(--muted-foreground)",
          }}
          className="pointer-events-none absolute left-3"
        >
          <Search className="h-4 w-4" />
        </motion.div>

        <Input
          className={cn(
            "w-full rounded-full",
            "pr-8 pl-9",
            "h-10",
            "bg-background/50 backdrop-blur-sm",
            "border-muted-foreground/20",
            "placeholder:text-muted-foreground/50",
            "focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20",
            "transition-all duration-200"
          )}
          onBlur={handleBlur}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          ref={inputRef}
          type="text"
          value={value}
        />

        <AnimatePresence>
          {value ? (
            <motion.button
              animate={{ opacity: 1, scale: 1 }}
              className="absolute right-3 text-muted-foreground transition-colors hover:text-foreground"
              exit={{ opacity: 0, scale: 0 }}
              initial={{ opacity: 0, scale: 0 }}
              onClick={handleClear}
              type="button"
            >
              <X className="h-4 w-4" />
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>

      <motion.div
        animate={{ opacity: isFocused ? 1 : 0 }}
        className="absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-orange-500/20 to-yellow-500/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100"
        initial={false}
      />
    </motion.div>
  );
}
