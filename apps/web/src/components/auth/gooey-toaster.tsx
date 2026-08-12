"use client";

import { mountToaster } from "gooey-toast";
import { useEffect } from "react";
import "gooey-toast/styles.css";
import { GOOEY_FILL } from "@/lib/gooey-toast";
import "./gooey-toast.css";

export function GooeyToaster() {
  useEffect(() => {
    const mounted = mountToaster({
      position: "bottom-right",
      offset: { right: 16, bottom: 16 },
      options: {
        fill: GOOEY_FILL,
        roundness: 12,
      },
    });

    return () => {
      mounted.unmount();
    };
  }, []);

  return null;
}
