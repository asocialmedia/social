"use client";

import { toast as gooeyToast } from "gooey-toast";
import type { ToastOptions } from "gooey-toast";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

type ToastVariant = "default" | "destructive";

interface ToastMessage {
  description?: ReactNode;
  duration?: number;
  icon?: ReactNode;
  styles?: ToastOptions["styles"];
  title?: string;
  variant?: ToastVariant;
}

export const GOOEY_FILL = "#232323";

const noop = (): void => undefined;

function buildGooeyOptions(
  title: string | undefined,
  resolvedDescription: string | number | Node | undefined,
  resolvedIcon: string | number | Node | undefined,
  duration: number,
  styles?: ToastOptions["styles"]
): ToastOptions {
  return {
    description: resolvedDescription,
    duration,
    fill: GOOEY_FILL,
    icon: resolvedIcon,
    roundness: 12,
    styles,
    title,
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
  container.textContent =
    node === null || node === undefined ? "" : String(node);
  return { node: container, unmount: noop };
}

export function toast({
  title,
  description,
  icon,
  styles,
  variant,
  duration = 5000,
}: ToastMessage) {
  const resolved = resolveNode(description);
  const resolvedIcon = resolveNode(icon);
  const options = buildGooeyOptions(
    title,
    resolved?.node,
    resolvedIcon?.node,
    duration,
    styles
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
