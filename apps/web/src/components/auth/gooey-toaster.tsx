"use client";

import { mountToaster } from "gooey-toast";
import { useEffect } from "react";

import "gooey-toast/styles.css";
import { GOOEY_FILL } from "@/lib/gooey-toast";

import "./gooey-toast.css";

export const GooeyToaster = () => {
  useEffect(() => {
    const mounted = mountToaster({
      offset: { bottom: 16, right: 16 },
      options: {
        fill: GOOEY_FILL,
        roundness: 12,
      },
      position: "bottom-right",
    });

    return () => {
      mounted.unmount();
    };
  }, []);

  return null;
};
