import { expect, test } from "bun:test";

import { requestErrorAttributes } from "./request-error";

test("reports render context without copying request secrets or action identifiers", () => {
  const attributes = requestErrorAttributes(
    Object.assign(new Error("render failed"), { digest: "3473582016" }),
    {
      headers: {
        authorization: "private-token",
        cookie: "private-session",
        "next-action": "private-action-id",
      },
      method: "POST",
      path: "/?sensitive=query",
    },
    {
      renderSource: "server-rendering",
      revalidateReason: "on-demand",
      routePath: "/",
      routeType: "render",
      routerKind: "App Router",
    }
  );
  expect(attributes).toEqual({
    digest: "3473582016",
    event: "web.request_error",
    hasServerAction: true,
    method: "POST",
    renderSource: "server-rendering",
    revalidateReason: "on-demand",
    routePath: "/",
    routeType: "render",
    routerKind: "App Router",
  });
  const serialized = JSON.stringify(attributes);
  for (const secret of [
    "private-token",
    "private-session",
    "private-action-id",
    "sensitive=query",
  ]) {
    expect(serialized).not.toContain(secret);
  }
});

test("handles thrown primitives and distinguishes ordinary POST requests", () => {
  expect(
    requestErrorAttributes(
      "failed",
      {
        headers: {},
        method: "POST",
        path: "/",
      },
      {
        revalidateReason: undefined,
        routePath: "/",
        routeType: "render",
        routerKind: "App Router",
      }
    )
  ).toMatchObject({ digest: undefined, hasServerAction: false });
});
