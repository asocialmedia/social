import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { RespondAction } from "./respond-action";

test.each([0, 1, 17])(
  "the response control includes its visible count in its accessible name (%s)",
  (count) => {
    const html = renderToStaticMarkup(
      <RespondAction count={count} onClick={() => {}} />
    );
    expect(html).toContain(
      `aria-label="Respond to this post, ${count} ${count === 1 ? "response" : "responses"}"`
    );
    expect(html).toContain(`>${count}</span>`);
  }
);
