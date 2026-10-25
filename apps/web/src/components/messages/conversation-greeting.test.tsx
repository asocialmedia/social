import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ConversationGreeting } from "./conversation-greeting";

describe("empty conversation greeting", () => {
  test("greets the recipient with Zeph and no encryption paragraph", () => {
    const html = renderToStaticMarkup(<ConversationGreeting name="anny" />);
    expect(html).toContain("Say hi to anny");
    expect(html).toContain('alt="Zeph waving hello"');
    expect(html).toContain("zeph-say-hi");
    expect(html).not.toContain("Encrypted");
    expect(html).not.toContain("holds the key");
  });
  test("names the room for a den", () => {
    const html = renderToStaticMarkup(
      <ConversationGreeting isDen name="The garden" />
    );
    expect(html).toContain("Say hi in The garden");
    expect(html).not.toContain("Say hi to");
  });
  test("escapes a recipient name supplied by another user", () => {
    const html = renderToStaticMarkup(
      <ConversationGreeting name='<img src=x onerror="alert(1)">' />
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=x");
  });
});
