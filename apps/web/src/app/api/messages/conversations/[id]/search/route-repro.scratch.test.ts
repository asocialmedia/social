import { describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve({
      user: { id: "11111111-1111-4111-8111-111111111101" },
    }),
}));

describe("POST /api/messages/conversations/:id/search with local services", () => {
  test("returns 2xx or handled error, never throws", async () => {
    const request = new Request(
      "http://localhost/api/messages/conversations/11111111-1111-4111-8111-111111111103/search",
      {
        body: JSON.stringify({ query: "veldrith" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({
        id: "11111111-1111-4111-8111-111111111103",
      }),
    });
    const body = await response.json();
    expect(response.status).toBeLessThan(500);
    expect(body).toEqual(
      expect.objectContaining({
        coverage: expect.any(Object),
        hits: expect.any(Array),
      })
    );
  });
});
