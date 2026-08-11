"use client";

import { toast as gooeyToast, type ToastOptions } from "gooey-toast";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

type ToastVariant = "default" | "destructive";

interface ToastMessage {
  description?: ReactNode;
  duration?: number;
  title?: string;
  variant?: ToastVariant;
}

export const GOOEY_FILL = "#232323";

const noop = (): void => undefined;

// Order of toast ids as they are shown; GooeyToaster pairs these with
// the DOM nodes it observes so it can wire up close buttons.
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

function reactNodeToDom(node: ReactNode): { node: Node; unmount: () => void } {
  const container = document.createElement("span");
  if (isValidElement(node)) {
    const root: Root = createRoot(container);
    flushSync(() => {
      root.render(node as ReactElement);
    });
    return {
      node: container,
      unmount: () => root.unmount(),
    };
  }
  if (node === null || node === undefined) {
    container.textContent = "";
  } else {
    container.textContent = String(node);
  }
  return { node: container, unmount: noop };
}

export function toast({
  title,
  description,
  variant,
  duration = 5000,
}: ToastMessage) {
  const resolved = resolveDescription(description);
  const options = buildGooeyOptions(title, resolved?.description, duration);

  const id =
    variant === "destructive"
      ? gooeyToast.error(options)
      : gooeyToast.success(options);

  // gooeyToast.success/error synchronously clones the description node,
  // so the temporary React root can be unmounted now to clean up effects,
  // timers and subscriptions.
  resolved?.unmount();

  pendingIds.push(id);

  return { id };
}

function resolveDescription(
  description: ReactNode | undefined
):
  | { description: string | number | Node | undefined; unmount: () => void }
  | undefined {
  if (description === undefined || description === null) {
    return;
  }
  if (typeof description === "string" || typeof description === "number") {
    return { description, unmount: noop };
  }
  const rendered = reactNodeToDom(description);
  return { description: rendered.node, unmount: rendered.unmount };
}

export function dismissToast(id: string) {
  gooeyToast.dismiss(id);
}

export function useToast() {
  return { toast };
}
