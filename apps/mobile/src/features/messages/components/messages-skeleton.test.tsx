import { expect, mock, test } from "bun:test";

import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function PlaceholderView({
  children,
  accessibilityLabel,
  accessibilityState,
  testID,
  className,
}: {
  children?: ReactNode;
  accessibilityLabel?: string;
  accessibilityState?: { busy?: boolean };
  testID?: string;
  className?: string;
}) {
  return createElement(
    "div",
    {
      "aria-busy": accessibilityState?.busy,
      "aria-label": accessibilityLabel,
      className,
      "data-testid": testID,
    },
    children
  );
}

mock.module("react-native", () => ({ View: PlaceholderView }));
mock.module("react-native-reanimated", () => ({
  default: { View: PlaceholderView },
  useAnimatedStyle: (read: () => { opacity: number }) => read(),
}));
mock.module("@/components/feedback/use-skeleton-pulse", () => ({
  useSkeletonPulse: () => ({ get: () => 0.6 }),
}));
mock.module("@/theme", () => ({
  useAppTheme: () => ({ theme: { dividerLine: "rgba(0,0,0,0.08)" } }),
}));

const { ConversationListSkeleton, ThreadSkeleton, MessageTilesSkeleton } =
  await import("./messages-skeleton");

test("conversation loading reserves rows and exposes one busy region", () => {
  const html = renderToStaticMarkup(<ConversationListSkeleton />);
  expect(html).toContain('aria-label="Loading conversations"');
  expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
  expect(html.match(/data-testid="conversation-skeleton-row"/g)).toHaveLength(
    7
  );
});

test("pagination and recipient loading can reserve a compact set of rows", () => {
  const html = renderToStaticMarkup(
    <ConversationListSkeleton rows={3} label="Loading shared items" />
  );
  expect(html).toContain('aria-label="Loading shared items"');
  expect(html.match(/data-testid="conversation-skeleton-row"/g)).toHaveLength(
    3
  );
});

test("thread loading has incoming and outgoing bubbles without duplicating the real composer", () => {
  const html = renderToStaticMarkup(
    <ThreadSkeleton label="Opening incognito messages" />
  );
  expect(html).toContain('aria-label="Opening incognito messages"');
  expect(html).toContain('aria-busy="true"');
  expect(html.match(/data-testid="message-skeleton-row"/g)).toHaveLength(5);
  expect(html).toContain("self-start");
  expect(html).toContain("self-end");
  expect(html).not.toContain("input");
});

test("reaction and sticker loading reserves image tiles with a busy label", () => {
  const html = renderToStaticMarkup(
    <MessageTilesSkeleton label="Loading stickers" />
  );
  expect(html).toContain('aria-label="Loading stickers"');
  expect(html).toContain('aria-busy="true"');
  expect(html.match(/data-testid="message-skeleton-tile"/g)).toHaveLength(6);
});
