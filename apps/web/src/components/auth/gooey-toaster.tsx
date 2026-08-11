"use client";

import { toast as gooeyToast, mountToaster } from "gooey-toast";
import { useEffect } from "react";
import "gooey-toast/styles.css";
import { GOOEY_FILL, takePendingToastId } from "@/lib/gooey-toast";
import "./gooey-toast.css";

const CLOSE_BUTTON_CLASS = "asm-gooey-close";

function attachCloseButton(toastEl: HTMLElement) {
  const id = takePendingToastId();
  if (!id) {
    return;
  }
  toastEl.dataset.asmClose = "true";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = CLOSE_BUTTON_CLASS;
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    gooeyToast.dismiss(id);
  });
  toastEl.appendChild(closeBtn);
}

function collectToastElements(node: Node): HTMLElement[] {
  const found: HTMLElement[] = [];
  if (node instanceof HTMLElement) {
    if (node.matches("[data-gooey-toast]")) {
      found.push(node);
    } else {
      const nested = node.querySelectorAll("[data-gooey-toast]");
      for (const el of nested) {
        found.push(el as HTMLElement);
      }
    }
  }
  return found;
}

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

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          for (const toastEl of collectToastElements(node)) {
            attachCloseButton(toastEl);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mounted.unmount();
    };
  }, []);

  return null;
}
