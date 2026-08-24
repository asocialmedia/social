"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import Spotlight from "./spotlight";
import type { SpotlightResultItem } from "./spotlight";

interface SpotlightContextValue {
  openSpotlight: (query?: string) => void;
}

const SpotlightContext = createContext<SpotlightContextValue | null>(null);

export function useSpotlight(): SpotlightContextValue {
  const context = useContext(SpotlightContext);
  if (!context) {
    throw new Error("useSpotlight must be used within a SpotlightProvider");
  }
  return context;
}

interface SpotlightProviderProps {
  children: React.ReactNode;
}

export const SpotlightProvider = ({ children }: SpotlightProviderProps) => {
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState("");
  const openRef = useRef(open);
  // oxlint-disable-next-line react/refs -- ref must mirror the latest open state for the keydown handler
  openRef.current = open;

  const openSpotlight = useCallback((query?: string) => {
    setInitialQuery(query ?? "");
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setInitialQuery("");
  }, []);

  const handleSelect = useCallback((_item: SpotlightResultItem) => {
    // Navigation is handled inside the Spotlight component itself
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) {
          handleClose();
        } else {
          openSpotlight();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, openSpotlight]);

  return (
    // eslint-disable-next-line react/jsx-no-constructed-context-values -- openSpotlight is stable via useCallback
    <SpotlightContext.Provider value={{ openSpotlight }}>
      {children}
      {open ? (
        <Spotlight
          initialQuery={initialQuery}
          onOpenChange={handleClose}
          onSelect={handleSelect}
          open={open}
        />
      ) : null}
    </SpotlightContext.Provider>
  );
};
