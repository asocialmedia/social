import { expect, test } from "bun:test";

import {
  isExpectedNextNavigation,
  requestErrorAttributes,
  requestNetworkErrorCodes,
} from "./request-error";

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

test("identifies only redirect and not-found control flow", () => {
  expect(isExpectedNextNavigation("NEXT_REDIRECT")).toBe(true);
  expect(isExpectedNextNavigation("NEXT_REDIRECT;replace;/profile;307;")).toBe(
    true
  );
  expect(isExpectedNextNavigation("NEXT_HTTP_ERROR_FALLBACK;404")).toBe(true);
  expect(isExpectedNextNavigation("NEXT_HTTP_ERROR_FALLBACK;403")).toBe(false);
  expect(isExpectedNextNavigation("Application error: NEXT_REDIRECT")).toBe(
    false
  );
});

test("extracts nested connection codes without copying addresses or messages", () => {
  const errors = [
    new Error("private hostname", {
      cause: new AggregateError(
        [
          Object.assign(new Error("private address"), { code: "ECONNREFUSED" }),
          Object.assign(new Error("private address"), { code: "ETIMEDOUT" }),
          Object.assign(new Error("private address"), { code: "private-data" }),
        ],
        "Connection attempts failed"
      ),
    }),
  ];
  expect(requestNetworkErrorCodes(errors)).toEqual([
    "ECONNREFUSED",
    "ETIMEDOUT",
  ]);
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
