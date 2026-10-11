import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import { DenAvatarCollage } from "./den-avatar-collage";

// React separates adjacent text nodes with a comment marker, so a rendered `+1`
// arrives as `+<!-- -->1`. Stripping the markers keeps the assertion about what a
// person sees rather than how React serialises it.
function visible(html: string): string {
  return html.replaceAll(/<!--.*?-->/gu, "");
}

function member(id: string, role?: string) {
  return {
    avatarUrl: `/api/users/avatar/${id}/image`,
    displayName: id,
    id,
    role,
    username: id,
  };
}

// Rendered rather than asserted on the pure helpers alone, because the thing that
// has to hold is geometry: circles inside a square frame, overlapping in face
// order, at exactly the tile's own size. A table of fractions in the component
// is easy to fat-finger, and a misplaced centre reads as noise rather than as
// layering - which is the failure this whole component exists to avoid.

describe("DenAvatarCollage", () => {
  test("a den with its own image draws that image full-bleed", () => {
    const html = renderToString(
      <DenAvatarCollage
        avatarMediaId="media-1"
        members={[member("u-me"), member("u-ada"), member("u-grace")]}
        myUserId="u-me"
        size={44}
      />
    );
    expect(html).toContain("/api/media/media-1");
    expect(visible(html)).not.toContain("+");
  });

  test("the tile is exactly square and a real box", () => {
    // The bug the stack had: a `display: inline` wrapper with inline width/height
    // and only absolute children measured 0x0, so dens without pictures drew empty
    // squares. Asserted on the class and the carried size, because
    // `renderToString` has no layout.
    const html = renderToString(
      <DenAvatarCollage
        members={[member("u-me"), member("u-ada"), member("u-grace")]}
        myUserId="u-me"
        size={44}
      />
    );
    expect(html).toContain("flex");
    // No clipping frame on the tile itself: the circles may overflow the nominal
    // box rather than being cut to it. Asserted on the wrapper's own opening tag,
    // because the face circles legitimately keep their own round clipping (that is
    // what makes a square photo read as a face).
    expect(html).toContain(
      '<span aria-hidden="true" class="relative flex shrink-0 items-center justify-center"'
    );
    expect(html).toContain("height:44px");
    expect(html).toContain("width:44px");
  });

  test("two faces sit on the diagonal, the second in front", () => {
    const html = renderToString(
      <DenAvatarCollage
        members={[member("u-me"), member("u-ada")]}
        myUserId="u-me"
        size={44}
      />
    );
    // d = 0.7 * 44 = 31. c1 top-left at (0, 0), c2 at (13, 13): an 18px
    // lens of overlap on a 31px face, which is what makes the diagonal read as
    // layering rather than a collision. React renders a zero offset unitless.
    expect(html).toContain("width:31px");
    expect(html).toContain("left:0;");
    expect(html).toContain("left:13px");
    // Face order is DOM order, and later siblings paint on top - so the second
    // face's URL comes after the first's, which is what makes the overlap
    // sequential rather than noise.
    expect(html.indexOf("/api/users/avatar/u-me/image")).toBeLessThan(
      html.indexOf("/api/users/avatar/u-ada/image")
    );
  });

  test("three faces make the triangle, one on top and two below", () => {
    const html = renderToString(
      <DenAvatarCollage
        members={[
          member("u-ada", "OWNER"),
          member("u-me", "ADMIN"),
          member("u-grace", "MEMBER"),
        ]}
        myUserId="u-me"
        size={44}
      />
    );
    // d = 0.5 * 44 = 22. The top face is centred; the bottom two share a row.
    expect(html).toContain("width:22px");
    expect(html).toContain("left:11px");
    const ada = html.indexOf("/api/users/avatar/u-ada/image");
    const me = html.indexOf("/api/users/avatar/u-me/image");
    const grace = html.indexOf("/api/users/avatar/u-grace/image");
    expect(ada).toBeLessThan(me);
    expect(me).toBeLessThan(grace);
  });

  test("four faces make the grid", () => {
    const html = renderToString(
      <DenAvatarCollage
        members={[
          member("u-me"),
          member("u-ada"),
          member("u-grace"),
          member("u-alan"),
        ]}
        myUserId="u-me"
        size={44}
      />
    );
    // d = 0.55 * 44 = 24, on the quarter grid.
    expect(html).toContain("width:24px");
    for (const id of ["u-me", "u-ada", "u-grace", "u-alan"]) {
      expect(html).toContain(`/api/users/avatar/${id}/image`);
    }
  });

  test("past four the tile counts instead of growing", () => {
    const html = renderToString(
      <DenAvatarCollage
        members={[
          member("u-me", "OWNER"),
          member("u-ada", "ADMIN"),
          member("u-grace", "MEMBER"),
          member("u-alan", "MEMBER"),
          member("u-edsger", "MEMBER"),
          member("u-dijkstra", "MEMBER"),
        ]}
        myUserId="u-me"
        size={44}
      />
    );
    // Three faces drawn, the fourth, fifth and sixth behind the tally, not beside it.
    expect(html).toContain("/api/users/avatar/u-me/image");
    expect(html).toContain("/api/users/avatar/u-ada/image");
    expect(html).toContain("/api/users/avatar/u-grace/image");
    expect(html).not.toContain("/api/users/avatar/u-alan/image");
    expect(html).not.toContain("/api/users/avatar/u-edsger/image");
    expect(html).not.toContain("/api/users/avatar/u-dijkstra/image");
    expect(visible(html)).toContain("+3");
  });

  test("the collage is aria-hidden, because the row already names the den", () => {
    const html = renderToString(
      <DenAvatarCollage
        members={[member("u-me"), member("u-ada"), member("u-grace")]}
        myUserId="u-me"
      />
    );
    expect(html).toContain('aria-hidden="true"');
  });

  test("a one-person den falls back to one avatar, which is correct", () => {
    // One face with nothing behind it is exactly what a one-person den is. A lone
    // circle in a square frame would read as a person's chat, which is the
    // confusion the pile exists to prevent - so a single face stays full-bleed.
    const html = renderToString(
      <DenAvatarCollage members={[member("u-me")]} myUserId="u-me" />
    );
    expect(html).toContain("/api/users/avatar/u-me/image");
    expect(visible(html)).not.toContain("+");
  });

  test("a den with nobody in it still draws something", () => {
    const html = renderToString(
      <DenAvatarCollage members={[]} myUserId="u-me" size={44} />
    );
    expect(html).toContain("<img");
  });
});
