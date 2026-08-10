"use client";

import { HashIcon, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { getRandomFact } from "@/components/constants/loading-facts";
import SearchField from "../search-field";

export default function MobileSearchButton() {
  const [open, setOpen] = useState(false);
  const [fact, setFact] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFact(getRandomFact());
    }
  }, [open]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (e.currentTarget === e.target) {
        setOpen(false);
      }
    },
    []
  );
  const handleEscapeKey = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);
  const handleBackdropMouseDown = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (e.currentTarget === e.target) {
        setOpen(false);
      }
    },
    []
  );

  return (
    <>
      <button
        className="flex h-10 w-full items-center gap-2 rounded-xl bg-muted px-3 text-left text-muted-foreground"
        onClick={handleOpen}
        type="button"
      >
        <HashIcon className="h-4 w-4" />
        <span className="block w-full truncate text-xs">
          Search Asocialmedia…
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[200] md:hidden">
            <motion.div
              animate={{ opacity: 1 }}
              className="fixed inset-0 bg-background/90 backdrop-blur-lg"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              onClick={handleClose}
              transition={{ duration: 0.2 }}
            />
            {fact ? (
              <div
                className="fixed right-0 left-0 z-[202] flex justify-center px-4"
                style={{ bottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
              >
                <div className="rounded-full border border-border/50 bg-card/80 px-3 py-1.5 text-center shadow-sm backdrop-blur">
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {fact}
                  </span>
                </div>
              </div>
            ) : null}
            <button
              aria-label="Close search"
              className="fixed inset-0 z-[201] flex items-start justify-center p-4 pt-20 focus:outline-none"
              onClick={handleBackdropClick}
              onKeyDown={handleEscapeKey}
              onMouseDown={handleBackdropMouseDown}
              type="button"
            >
              <motion.div
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="w-full max-w-md"
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <div className="relative overflow-visible rounded-2xl border border-border/50 bg-background p-4 pb-6 shadow-lg backdrop-blur-xl">
                  <button
                    className="absolute top-3 right-3 rounded-full p-2 text-muted-foreground hover:bg-primary/10"
                    onClick={handleClose}
                    type="button"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <SearchField onAfterSearch={handleClose} />
                </div>
              </motion.div>
            </button>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
