import { expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import { MessageThreadSkeleton, MessagesSkeleton } from "./messages-skeleton";

test("messages loading distinguishes list and thread mobile layouts", () => {
  expect(renderToString(<MessagesSkeleton />)).toContain(
    'data-messages-skeleton="list"'
  );
  expect(renderToString(<MessagesSkeleton conversationOpen />)).toContain(
    'data-messages-skeleton="thread"'
  );
});

test("thread loading reserves composer space and bounds bubbles to narrow screens", () => {
  const html = renderToString(<MessageThreadSkeleton />);
  expect(html).toContain("data-skeleton-composer");
  expect(html).toContain("max-w-[78%]");
  expect(html).toContain("justify-start");
  expect(html).toContain("justify-end");
});
