"use client";

import { Button } from "@asm/ui/shadui/button";
import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import SearchField from "./search-field";

export default function SearchToggle() {
  const [open, setOpen] = useState(true);

  const handleOpen = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1200) {
        setOpen(true);
      } else if (window.innerWidth < 980) {
        setOpen(false);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="hidden md:block">
      {open ? (
        <div className="w-[300px]">
          <SearchField />
        </div>
      ) : (
        <Button
          className="border-border/50 bg-background/40 text-muted-foreground hover:bg-background/60 hover:text-foreground h-11 rounded-xl border px-3"
          onClick={handleOpen}
          variant="ghost"
        >
          <Search className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
