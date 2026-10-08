import { describe, expect, mock, test } from "bun:test";

import type { Drawer } from "@asm/ui/shadui/drawer";
import type { ComponentProps, ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { ConversationDetailsDrawer } from "./conversation-details-drawer";

let drawerProps: ComponentProps<typeof Drawer> | undefined;

// Portals do not render in SSR. Keep the shell inline to verify its visible
// content and the gesture/dismissal contract passed to the drawer primitive.
mock.module("@asm/ui/shadui/drawer", () => ({
  Drawer: (props: ComponentProps<typeof Drawer>) => {
    drawerProps = props;
    return <div>{props.children}</div>;
  },
  DrawerContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className: string;
  }) => <div className={className}>{children}</div>,
  DrawerHandle: () => <div data-drag-handle />,
}));

function renderDrawer(onClose = mock(() => {})) {
  const html = renderToString(
    <ConversationDetailsDrawer onClose={onClose}>
      <button type="button">Existing bottom control</button>
    </ConversationDetailsDrawer>
  );
  if (!drawerProps) {
    throw new Error("Drawer root did not render");
  }
  return { html, onClose, props: drawerProps };
}

describe("mobile conversation details drawer", () => {
  test("opens at 60% with a reversible full-height snap point", () => {
    const { props } = renderDrawer();
    expect(props.activeSnapPoint).toBe(0.6);
    expect(props.snapPoints).toEqual([0.6, 1]);
    expect(props.snapToSequentialPoint).toBe(true);
    expect(props.handleOnly).not.toBe(true);
    expect(props.dismissible).not.toBe(false);
  });

  test("keeps the outside overlay visible and restores modal focus behavior", () => {
    const { props } = renderDrawer();
    expect(props.fadeFromIndex).toBe(0);
    expect(props.autoFocus).toBe(true);
    expect(props.shouldScaleBackground).toBe(false);
    expect(props.modal).not.toBe(false);
  });

  test("outside dismissal retains the panel until its closing animation finishes", () => {
    const { onClose, props } = renderDrawer();
    props.onOpenChange?.(true);
    expect(onClose).not.toHaveBeenCalled();
    props.onOpenChange?.(false);
    expect(onClose).not.toHaveBeenCalled();
    props.onAnimationEnd?.(true);
    expect(onClose).not.toHaveBeenCalled();
    props.onAnimationEnd?.(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("fits bottom controls inside the visible snap height and retains dismissal", () => {
    const { html } = renderDrawer();
    expect(html).toContain("--snap-point-height");
    expect(html).toContain("Existing bottom control");
    expect(html).toContain('aria-label="Close chat details"');
    expect(html).toContain("Expand chat details");
    expect(html).toContain("data-drag-handle");
  });
});
