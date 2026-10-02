import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import { PickerRow } from "./member-picker";

// The picker's row, rendered rather than asserted through its props. The thing
// that has to hold is accessibility, and accessibility lives in the DOM: a
// selection has to announce itself as pressed, and a row that cannot be picked
// has to say why rather than just going grey.

const person = {
  avatarUrl: "/api/users/avatar/u-ada/image",
  displayName: "Ada",
  hasIdentity: true,
  id: "u-ada",
  username: "ada",
};

describe("PickerRow", () => {
  test("announces its selection state, because the tick is only decoration", () => {
    expect(
      renderToString(<PickerRow onSelect={() => {}} person={person} />)
    ).toContain('aria-pressed="false"');
    expect(
      renderToString(<PickerRow onSelect={() => {}} person={person} selected />)
    ).toContain('aria-pressed="true"');
  });

  test("is a real button, so it is keyboard-operable for free", () => {
    const html = renderToString(
      <PickerRow onSelect={() => {}} person={person} />
    );
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  test("a row that cannot be picked is disabled and says why", () => {
    // A greyed-out row with no words is indistinguishable from a broken control.
    // The reason is spelled into the row's own text, so it is read by a screen
    // reader as well as seen.
    const html = renderToString(
      <PickerRow
        disabled
        onSelect={() => {}}
        person={person}
        unavailableReason="hasn't enabled Messages"
      />
    );
    expect(html).toContain("disabled");
    expect(html).toContain("hasn&#x27;t enabled Messages");
  });

  test("an available row carries no reason", () => {
    const html = renderToString(
      <PickerRow onSelect={() => {}} person={person} />
    );
    expect(html).not.toContain("disabled");
    expect(html).toContain("@ada");
  });

  test("names the person, so the row is its own accessible name", () => {
    const html = renderToString(
      <PickerRow onSelect={() => {}} person={person} />
    );
    expect(html).toContain("Ada");
    expect(html).toContain("@ada");
  });
});
