import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import { DenAvatarStack } from "./den-avatar-stack";

// React separates adjacent text nodes with a comment marker, so a rendered `+1`
// arrives as `+<!-- -->1`. Stripping the markers keeps the assertion about what a
// person sees rather than about how React serialises it.
function visible(html: string): string {
  return html.replaceAll(/<!--.*?-->/gu, "");
}

// Rendered rather than asserted on the pure helpers alone, because the thing that
// has to hold is not "which faces were chosen" -- that is `denAvatarFaces`' job
// and is tested there -- but "the stack never renders as a single person's chat".
// A den is not a person, so an avatar that could be mistaken for one is the bug
// this guards.

function member(id: string, role?: string) {
  return {
    avatarUrl: `/api/users/avatar/${id}/image`,
    displayName: id,
    id,
    role,
    username: id,
  };
}

describe("DenAvatarStack", () => {
  test("a den with its own image draws that image as one avatar", () => {
    // One picture the den chose is a better identity than three overlapping
    // strangers, and it is the shape the avatar proxy already knows how to serve.
    const html = renderToString(
      <DenAvatarStack
        avatarMediaId="media-1"
        members={[member("u-me"), member("u-ada"), member("u-grace")]}
        myUserId="u-me"
        size={44}
      />
    );
    expect(html).toContain("/api/media/media-1");
    // Not a stack: no overlap offsets, and no "+N" tally.
    expect(visible(html)).not.toContain("+");
  });

  test("a den without one stacks the members instead", () => {
    const html = renderToString(
      <DenAvatarStack
        members={[
          member("u-me"),
          member("u-ada", "OWNER"),
          member("u-grace", "MEMBER"),
          member("u-alan", "MEMBER"),
          member("u-edsger", "MEMBER"),
        ]}
        myUserId="u-me"
        size={44}
      />
    );
    // Three faces drawn, the rest counted rather than dropped: a +N is how the row
    // stays honest about a 100-member den without painting 100 avatars.
    expect(visible(html)).toContain("+1");
    expect(html).toContain("/api/users/avatar/u-ada/image");
    expect(html).toContain("/api/users/avatar/u-grace/image");
    expect(html).toContain("/api/users/avatar/u-alan/image");
    // The cap holds: the fourth face is behind the tally, not beside it.
    expect(html).not.toContain("/api/users/avatar/u-edsger/image");
    // The reader is never one of the faces; a den does not introduce you to
    // yourself.
    expect(html).not.toContain("/api/users/avatar/u-me/image");
  });

  test("the stack is aria-hidden, because the row already names the den", () => {
    // A screen reader announcing three unnamed images above a row that says
    // "Study group" would be three interruptions for nothing.
    const html = renderToString(
      <DenAvatarStack
        members={[member("u-me"), member("u-ada"), member("u-grace")]}
        myUserId="u-me"
      />
    );
    expect(html).toContain('aria-hidden="true"');
  });

  test("a two-person den falls back to one avatar, which is correct", () => {
    // One face with nothing behind it is exactly what a two-person den is, and a
    // one-face "stack" would read as a bug in the stack.
    const html = renderToString(
      <DenAvatarStack
        members={[member("u-me"), member("u-ada")]}
        myUserId="u-me"
      />
    );
    expect(html).toContain("/api/users/avatar/u-ada/image");
    expect(visible(html)).not.toContain("+");
  });

  test("a den with nobody else in it still draws something", () => {
    // The create rules prevent a solo den, but a just-loaded roster can render
    // empty, and a 0x0 box would collapse the whole row.
    const html = renderToString(
      <DenAvatarStack members={[member("u-me")]} myUserId="u-me" size={44} />
    );
    expect(html).toContain("<img");
  });
});
