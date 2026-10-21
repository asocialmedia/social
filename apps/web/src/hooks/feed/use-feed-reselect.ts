import { useRef } from "react";

// Capture selection before Radix activates a different tab on pointer down.
export function useFeedReselect(active: boolean, onReselect?: () => void) {
  const pressedActive = useRef<boolean | null>(null);
  return {
    onClick: () => {
      const reselected = pressedActive.current ?? active;
      pressedActive.current = null;
      if (reselected) {
        onReselect?.();
      }
    },
    onKeyDown: (event: { key: string }) => {
      if (event.key === "Enter" || event.key === " ") {
        pressedActive.current = active;
      }
    },
    onPointerDown: () => {
      pressedActive.current = active;
    },
  };
}
