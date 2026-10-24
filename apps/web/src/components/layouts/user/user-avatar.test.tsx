import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import UserAvatar from "./user-avatar";

test("Bluesky avatar derivatives load directly instead of timing out in the Next image optimizer", () => {
  const src =
    "https://cdn.bsky.app/img/avatar/plain/did:plc:alice/example@jpeg";
  const html = renderToStaticMarkup(<UserAvatar avatarUrl={src} />);
  expect(html).toContain(`src="${src}"`);
  expect(html).not.toContain("/_next/image");
});
