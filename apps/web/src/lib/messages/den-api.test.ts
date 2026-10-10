import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import {
  denErrorResponse,
  objectOf,
  optionalStringField,
  readJsonBody,
  requireApiUser,
} from "./den-api";

// Every den route answers failures through this module, so the two things worth
// pinning here are the status split the client branches on - 403 stops retrying,
// 404 drops the surface, 409 means re-read rather than retry - and the difference
// between "absent" and "null", which is what lets a field be cleared without
// being silently dropped.

// Redefined rather than imported so the thrown instances and the class the
// helper checks against are the same object. The code union still comes from the
// real class, so a code added to the service cannot go untested here.
class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

// Shaped the way the helper reads it - `session?.user?.id` - so a session whose
// user is missing can be described without a type assertion.
interface ApiSession {
  user?: { id?: string | null } | null;
}
const mockGetSession = mock((): ApiSession | null => ({
  user: { id: "user1" },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  DenError,
}));

describe("requireApiUser", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
  });

  test("answers 401 when there is no session", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const result = await requireApiUser();
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected an unauthenticated result");
    }
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Unauthorized" });
  });

  test("answers 401 for a session with no user on it", async () => {
    // A session row whose user was deleted underneath it still resolves to a
    // session, so the user has to be read off it rather than assumed.
    mockGetSession.mockReturnValueOnce({});
    const result = await requireApiUser();
    expect(result.ok).toBe(false);
  });

  test("answers 401 for a session with no id on its user", async () => {
    mockGetSession.mockReturnValueOnce({ user: {} });
    const result = await requireApiUser();
    expect(result.ok).toBe(false);
  });

  test("answers the viewer's id when there is a session", async () => {
    const result = await requireApiUser();
    expect(result).toEqual({ ok: true, userId: "user1" });
  });
});

describe("denErrorResponse", () => {
  test("maps every code to the status the client branches on", () => {
    const cases = [
      ["ALREADY_MEMBER", 409],
      ["FORBIDDEN", 403],
      ["INVALID_INPUT", 400],
      ["INVALID_ROLE", 400],
      ["LIMIT_REACHED", 409],
      ["MEMBERS_REQUIRED", 400],
      ["NOT_A_DEN", 409],
      ["NOT_FOUND", 404],
      ["SELF_ACTION", 409],
    ] as const satisfies readonly (readonly [DenErrorClass["code"], number])[];
    for (const [code, status] of cases) {
      const response = denErrorResponse(new DenError(code, "refused"), {
        operation: "den.test",
      });
      expect(response.status).toBe(status);
    }
  });

  test("forwards the code and the message, both already written for a human", async () => {
    const response = denErrorResponse(
      new DenError("NOT_A_DEN", "That is not a den"),
      { operation: "den.test" }
    );
    expect(await response.json()).toEqual({
      code: "NOT_A_DEN",
      error: "That is not a den",
    });
  });

  test("answers 500 for anything that is not a domain outcome", async () => {
    // A bug, not a refusal: no code, and the internal message is not forwarded
    // to the caller because it says more about the server than the fix.
    const thrown = [
      new Error("connection string is postgres://..."),
      new TypeError("cannot read id of undefined"),
      "a string",
      null,
    ];
    const responses = thrown.map((error) =>
      denErrorResponse(error, { operation: "den.test" })
    );
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    );
    for (const response of responses) {
      expect(response.status).toBe(500);
    }
    for (const body of bodies) {
      expect(body).toEqual({ error: "Couldn't complete that, try again?" });
    }
  });
});

describe("objectOf", () => {
  test("accepts only a plain object", () => {
    expect(objectOf({ a: 1 })).toEqual({ a: 1 });
    // A list and a null are both "not an object" for the body parser, and both
    // have to reach the same 400 rather than being read as field bags.
    expect(objectOf([1, 2])).toBeNull();
    expect(objectOf(null)).toBeNull();
    expect(objectOf()).toBeNull();
    expect(objectOf("nope")).toBeNull();
    expect(objectOf(7)).toBeNull();
  });
});

describe("optionalStringField", () => {
  test("reports an absent key as undefined so the field is left alone", () => {
    expect(optionalStringField({ name: "den" }, "description")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(optionalStringField(null, "description")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test("reports an explicit null as null so the field is cleared", () => {
    // The whole reason this is not a truthiness check: absent means "do not
    // touch", null means "clear", and collapsing the two would make a details
    // panel guess which one it was sent.
    expect(optionalStringField({ description: null }, "description")).toEqual({
      ok: true,
      value: null,
    });
  });

  test("refuses anything else rather than coercing it", () => {
    for (const value of [7, true, ["den"], { den: true }]) {
      expect(optionalStringField({ name: value }, "name")).toEqual({
        ok: false,
      });
    }
  });

  test("passes a string through untouched", () => {
    expect(optionalStringField({ name: "  den  " }, "name")).toEqual({
      ok: true,
      value: "  den  ",
    });
  });
});

describe("readJsonBody", () => {
  test("returns null for a body that is not JSON", async () => {
    const request = new Request("http://localhost:3000/api/messages/dens/x", {
      body: "{not json",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await readJsonBody(request)).toBeNull();
  });

  test("returns null for a body with no bytes at all", async () => {
    const request = new Request("http://localhost:3000/api/messages/dens/x", {
      method: "POST",
    });
    expect(await readJsonBody(request)).toBeNull();
  });

  test("returns the parsed body otherwise", async () => {
    const request = new Request("http://localhost:3000/api/messages/dens/x", {
      body: JSON.stringify({ memberIds: ["user-2"] }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await readJsonBody(request)).toEqual({ memberIds: ["user-2"] });
  });
});
