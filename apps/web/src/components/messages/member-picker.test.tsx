import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { GROUP_ADD_REFUSAL_COPY } from "@asm/db/messages/dens";
import { renderToString } from "react-dom/server";

import { DEN_BAN_PICKER_REFUSAL } from "@/lib/messages/den-ban-copy";

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

  // A banned candidate is SHOWN and labelled, not hidden. Hiding them would leave a
  // manager who typed a name into an invite picker staring at an empty list, with no
  // way to tell a ban apart from a typo.
  test("a banned candidate is greyed out and says so", () => {
    const html = renderToString(
      <PickerRow
        disabled
        onSelect={() => {}}
        person={person}
        unavailableReason={DEN_BAN_PICKER_REFUSAL}
      />
    );
    expect(html).toContain("disabled");
    expect(html).toContain("banned from this den");
  });

  // The reason names the den, not the account, and says nothing about who banned them
  // or why - the same restraint the banned list itself keeps, since the picker is a
  // place a manager is looking at candidates rather than at decisions.
  test("the ban reason stays about the ban", () => {
    expect(DEN_BAN_PICKER_REFUSAL).toContain("banned from this den");
    expect(DEN_BAN_PICKER_REFUSAL).not.toMatch(/(?<word>\byou(?:r)?\b)/iu);
    expect(DEN_BAN_PICKER_REFUSAL).not.toMatch(/Elder|owner/i);
  });

  test("names the person, so the row is its own accessible name", () => {
    const html = renderToString(
      <PickerRow onSelect={() => {}} person={person} />
    );
    expect(html).toContain("Ada");
    expect(html).toContain("@ada");
  });
});

// `MemberPicker` itself is hook-bound - session, search, conversation list - so it cannot
// be rendered here, which is the same reason `PickerRow` is exported and tested on its
// own. That leaves the wiring unobservable from a render, and the wiring is exactly what
// broke: `bannedIds` was a documented prop with complete dead-row handling behind it and
// no call site, so a banned person was fully selectable and the dialog kept promising
// they would be greyed out.
//
// So this reads the source instead. A source assertion is a weaker thing than a render -
// it cannot tell a working prop from a typo'd one - but it fails on the regression that
// actually happened, which no render in this repo's tooling would have caught.
describe("the panel passes the ban list to the picker", () => {
  const panelSource = readFileSync(
    path.join(import.meta.dir, "den-panel.tsx"),
    "utf-8"
  );
  // A newline as a value rather than an escape, so the JSX tag search below is one
  // readable line instead of a literal line break inside a string.
  const NEWLINE = String.fromCodePoint(10);
  const callSiteStart = panelSource.indexOf(`<MemberPicker${NEWLINE}`);

  test("the MemberPicker call site supplies bannedIds", () => {
    // Scoped to the element rather than the whole file, so an unrelated mention of the
    // prop elsewhere in the panel cannot satisfy this.
    const callSite = panelSource.slice(
      callSiteStart,
      panelSource.indexOf("/>", callSiteStart)
    );
    expect(callSite).toContain("bannedIds=");
  });

  test("and it is fed from the bans the panel already fetched", () => {
    // The other half of the same regression: a hardcoded empty list would satisfy the
    // assertion above while greying out nobody.
    expect(panelSource).toMatch(/bannedIds=\{bans\.data\?\.map\(/u);
  });
});
