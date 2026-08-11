"use client";

import { toast as gooeyToast, type ToastOptions } from "gooey-toast";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

type ToastVariant = "default" | "destructive";

interface ToastMessage {
  description?: ReactNode;
  duration?: number;
  title?: string;
  variant?: ToastVariant;
}

export const GOOEY_FILL = "#232323";

/** Order of toast ids as they are shown; GooeyToaster pairs these with
 *  the DOM nodes it observes so it can wire up close buttons. */
const pendingIds: string[] = [];

export function takePendingToastId(): string | undefined {
  return pendingIds.shift();
}

function buildGooeyOptions(
  title: string | undefined,
  resolvedDescription: string | number | Node | undefined,
  duration: number
): ToastOptions {
  return {
    title,
    description: resolvedDescription,
    duration,
    fill: GOOEY_FILL,
    roundness: 12,
  };
}

function reactNodeToDom(node: ReactNode): Node {
  const container = document.createElement("span");
  if (isValidElement(node)) {
    flushSync(() => {
      createRoot(container).render(node as ReactElement);
    });
  } else if (node === null || node === undefined) {
    container.textContent = "";
  } else {
    container.textContent = String(node);
  }
  return container;
}

export function toast({
  title,
  description,
  variant,
  duration = 5000,
}: ToastMessage) {
  const resolvedDescription = resolveDescription(description);
  const options = buildGooeyOptions(title, resolvedDescription, duration);

  const id =
    variant === "destructive"
      ? gooeyToast.error(options)
      : gooeyToast.success(options);
  pendingIds.push(id);

  return { id };
}

function resolveDescription(
  description: ReactNode | undefined
): string | number | Node | undefined {
  if (description === undefined || description === null) {
    return;
  }
  if (typeof description === "string" || typeof description === "number") {
    return description;
  }
  return reactNodeToDom(description);
}

export function dismissToast(id: string) {
  gooeyToast.dismiss(id);
}

export function useToast() {
  return { toast };
}
