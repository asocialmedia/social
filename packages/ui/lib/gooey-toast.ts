"use client";

import { toast as gooeyToast, type ToastOptions } from "gooey-toast";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

type ToastVariant = "default" | "destructive";

interface ToastMessage {
  description?: ReactNode;
  duration?: number;
  icon?: ReactNode;
  title?: string;
  variant?: ToastVariant;
}

export const GOOEY_FILL = "#232323";

const noop = (): void => undefined;

function buildGooeyOptions(
  title: string | undefined,
  resolvedDescription: string | number | Node | undefined,
  resolvedIcon: string | number | Node | undefined,
  duration: number
): ToastOptions {
  return {
    title,
    description: resolvedDescription,
    icon: resolvedIcon,
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
  icon,
  variant,
  duration = 5000,
}: ToastMessage) {
  const resolved = resolveNode(description);
  const resolvedIcon = resolveNode(icon);
  const options = buildGooeyOptions(
    title,
    resolved?.node,
    resolvedIcon?.node,
    duration
  );

  if (variant === "destructive") {
    gooeyToast.error(options);
  } else {
    gooeyToast.success(options);
  }

  // gooeyToast.success/error synchronously clones the rendered nodes, so the
  // temporary React roots can be unmounted now to clean up effects, timers
  // and subscriptions.
  resolved?.unmount();
  resolvedIcon?.unmount();
}

function resolveNode(
  node: ReactNode | undefined
):
  | { node: string | number | Node | undefined; unmount: () => void }
  | undefined {
  if (node === undefined || node === null) {
    return;
  }
  if (typeof node === "string" || typeof node === "number") {
    return { node, unmount: noop };
  }
  const rendered = reactNodeToDom(node);
  return { node: rendered.node, unmount: rendered.unmount };
}

export function useToast() {
  return { toast };
}
