import { describe, expect, test } from "bun:test";

import { GROUP_ADD_REFUSAL_COPY } from "@asm/db/messages/dens";
import { renderToString } from "react-dom/server";

import { PickerRow } from "./member-picker";

// The picker's row, rendered rather than asserted through its props. The thing
// that has to hold is accessibility, and accessibility lives in the DOM: a
// selection has to announce itself as pressed, and a row that cannot be picked
// has to say why rather than just going grey.

const person = {
  addRefusal: null,
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

  test("a candidate who will not accept a direct add is greyed out with their reason", () => {
    // The picker's whole job for this rule. The row is disabled for the same
    // reason a missing identity disables it, and the wording comes from the same
    // shared map the route's refusal uses - so the reader is told the same fact
    // here as they would be after a refused submit, and cannot be shown a live
    // row the server will turn away.
    for (const refusal of ["NO_DIRECT_ADDS", "NOT_FOLLOWING_YOU"] as const) {
      const html = renderToString(
        <PickerRow
          disabled
          onSelect={() => {}}
          person={{ ...person, addRefusal: refusal }}
          unavailableReason={GROUP_ADD_REFUSAL_COPY[refusal]}
        />
      );
      expect(html).toContain("disabled");
      // Apostrophes arrive escaped, which is why the existing reason assertion in
      // this file spells one out rather than interpolating it.
      expect(html).toContain(
        GROUP_ADD_REFUSAL_COPY[refusal].replaceAll("'", "&#x27;")
      );
    }
  });

  test("the group-add reasons are about the candidate, never about the reader", () => {
    // Rendered on a row the reader is looking at and in the error a refused add
    // returns, so a sentence that said "you" would be wrong for one of the two.
    for (const copy of Object.values(GROUP_ADD_REFUSAL_COPY)) {
      expect(copy).not.toMatch(/\byou\b/i);
    }
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
