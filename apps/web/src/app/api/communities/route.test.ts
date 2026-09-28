import { beforeEach, describe, expect, mock, test } from "bun:test";

const createCommunity = mock((input: unknown) => {
  if (
    typeof input === "object" &&
    input !== null &&
    "description" in input &&
    "slug" in input
  ) {
    return Promise.resolve({
      id: "community-1",
      name: "General",
      slug: "general",
    });
  }
  return Promise.reject(new Error("Invalid community"));
});

mock.module("@/communities/actions", () => ({ createCommunity }));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve({ user: { id: "user-1" } }),
}));

const { POST } = await import("./route");

beforeEach(() => {
  createCommunity.mockClear();
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/communities", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/communities", () => {
  test("creates a community through the shared server action", async () => {
    const response = await POST(
      request({
        description: "A place to talk",
        name: "General",
        slug: "general",
        topics: ["chat"],
        type: "PUBLIC",
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ slug: "general" });
    expect(createCommunity).toHaveBeenCalledTimes(1);
  });

  test("returns a client error for invalid input", async () => {
    const response = await POST(request({ name: "General" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid community" });
  });
});
