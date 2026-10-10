import { describe, expect, test } from "bun:test";

import { denJoinHandoff, denJoinWebUrl } from "./den-link";

// Where a den link goes on a phone that has no den.
//
// An invite link is the widest door in the product, so it is very likely to be
// opened inside the native app by somebody who tapped it in a chat they are
// reading there. Without a route it falls through to `+not-found`, which tells
// them the page does not exist - and that is false, because it does, on the web,
// and it works. These are the two things that has to stop being false.

describe("the native join screen", () => {
  test("the deep link is claimed by a route, not by +not-found", async () => {
    // The whole reason this screen exists. Expo Router sends an unmatched path to
    // `+not-found`, which says the page does not exist - and for
    // `asocialmedia://messages/join/<code>` that is a false thing to say, because
    // the page does exist, on the web, and it works. A file at this exact path is
    // what turns that into an honest explanation instead of a denial.
    const route = Bun.file(
      new URL("../../../app/messages/join/[code].tsx", import.meta.url)
    );
    expect(await route.exists()).toBe(true);
  });
});

describe("denJoinWebUrl", () => {
  test("builds the web join screen's path", () => {
    expect(denJoinWebUrl("https://asocialmedia.cc", "abc234")).toBe(
      "https://asocialmedia.cc/messages/join/abc234"
    );
  });

  test("the prefix is a route that actually exists on the web", async () => {
    // Checked against the file rather than against another constant, because
    // another constant would drift in exactly the same way. The mobile app cannot
    // import the web module, so the path is spelled twice and this is what keeps
    // the two copies honest.
    // The mobile app's test file is three directories below `src`, and the web
    // app is a sibling workspace, so the path is walked explicitly rather than
    // guessed with a variable number of `..`.
    const page = Bun.file(
      new URL(
        "../../../../../web/src/app/(main)/messages/join/[code]/page.tsx",
        import.meta.url
      )
    );
    expect(await page.exists()).toBe(true);
  });

  test("does not double a trailing slash on the origin", () => {
    expect(denJoinWebUrl("https://asocialmedia.cc/", "abc234")).toBe(
      "https://asocialmedia.cc/messages/join/abc234"
    );
  });

  test("normalizes the code the way the server normalizes before comparing", () => {
    // A code carried out of a chat or a screenshot arrives padded and shouty. The
    // alphabet is lowercase, so folding case cannot make a real code stop
    // resolving and the link keeps working.
    expect(denJoinWebUrl("https://asocialmedia.cc", " ABC234\n")).toBe(
      "https://asocialmedia.cc/messages/join/abc234"
    );
  });

  test("escapes a code rather than letting it shape the URL", () => {
    expect(denJoinWebUrl("https://asocialmedia.cc", "a/b?c=d")).toBe(
      "https://asocialmedia.cc/messages/join/a%2Fb%3Fc%3Dd"
    );
  });

  test("an empty code has no screen to open, so it goes to the messages index", () => {
    // `/messages/join/` would 404 on the web too, so this is the same dead end the
    // web client answers rather than a new one.
    expect(denJoinWebUrl("https://asocialmedia.cc", "")).toBe(
      "https://asocialmedia.cc/messages"
    );
    expect(denJoinWebUrl("https://asocialmedia.cc", "   ")).toBe(
      "https://asocialmedia.cc/messages"
    );
  });
});

describe("denJoinHandoff", () => {
  test("a code is carried across intact, with a way to open it", () => {
    const handoff = denJoinHandoff("ABC234", "https://asocialmedia.cc");
    expect(handoff.webUrl).toBe("https://asocialmedia.cc/messages/join/abc234");
    // The copy names the gap rather than describing a product this app does not
    // have. A link is the one place a reader is most likely to believe the app
    // can do the thing it just sent them, so a vague "coming soon" here would be
    // the lie.
    expect(handoff.title).toBe("Open this den on the web");
    expect(handoff.body).toContain("aren't in this app yet");
  });

  test("a link with no code offers nothing to open", () => {
    // Offering a button that opens a link with nothing in it would be a dead end
    // with a call to action on it, which is worse than saying so.
    const handoff = denJoinHandoff("   ", "https://asocialmedia.cc");
    expect(handoff.webUrl).toBeNull();
    expect(handoff.title).toBe("This link looks incomplete");
  });

  test("does not decide locally whether a code is valid", () => {
    // Whether a code resolves, was retired, or names a den that is already full is
    // a question only the server can answer, and the web join screen is where that
    // answer is rendered in words a reader can act on. A local length check here
    // would be a second place to be wrong, and its failure mode would be the app
    // refusing to open a link the web would have accepted.
    const short = denJoinHandoff("abc", "https://asocialmedia.cc");
    expect(short.webUrl).toBe("https://asocialmedia.cc/messages/join/abc");
  });
});
