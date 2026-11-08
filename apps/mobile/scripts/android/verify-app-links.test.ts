import { expect, test } from "bun:test";

import statements from "../../../web/public/.well-known/assetlinks.json";
import { verifyAppLinksHost } from "./verify-app-links";

test("deployment verification checks each host directly without following redirects", async () => {
  const urls: string[] = [];
  for (const host of ["asocialmedia.cc", "www.asocialmedia.cc"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Verify hosts in deterministic order for the URL assertions.
    await verifyAppLinksHost(host, (url, init) => {
      urls.push(url);
      expect(init.redirect).toBe("manual");
      return Response.json(statements);
    });
  }
  expect(urls).toEqual([
    "https://asocialmedia.cc/.well-known/assetlinks.json",
    "https://www.asocialmedia.cc/.well-known/assetlinks.json",
  ]);
  await expect(
    verifyAppLinksHost(
      "www.asocialmedia.cc",
      () =>
        new Response(null, {
          headers: { location: "https://asocialmedia.cc" },
          status: 301,
        })
    )
  ).rejects.toThrow("direct 200");
  await expect(
    verifyAppLinksHost(
      "asocialmedia.cc",
      () =>
        new Response("<html>fallback</html>", {
          headers: { "content-type": "text/html" },
        })
    )
  ).rejects.toThrow("application/json");
  await expect(
    verifyAppLinksHost("asocialmedia.cc", () =>
      Response.json(
        statements.map(
          ({ relation_extensions: _rules, ...statement }) => statement
        )
      )
    )
  ).rejects.toThrow("About rules");
});
