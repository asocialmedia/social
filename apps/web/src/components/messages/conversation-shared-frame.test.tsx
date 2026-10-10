import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ListFooter } from "./conversation-shared-frame";

describe("shared reference coverage footer", () => {
  test("explains terminal missing history without claiming a backfill is running", () => {
    const markup = renderToStaticMarkup(
      <ListFooter
        coverageUnavailable
        indexing={false}
        noun="media"
        readError={false}
      />
    );

    expect(markup).toContain("Some older shared items couldn&#x27;t be loaded");
    expect(markup).not.toContain("Looking further back");
  });
});
