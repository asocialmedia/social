import { describe, expect, test } from "bun:test";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthEndpoint } from "better-auth/api";
import { username } from "better-auth/plugins";

import { socialUsername } from "./social-username";

function fixture(path = "/callback/reddit") {
  const rows: Record<string, Record<string, unknown>[]> = {
    user: [
      {
        email: "existing@example.com",
        id: "existing",
        username: "parazeeknova",
      },
    ],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3001",
    database: memoryAdapter(rows),
    plugins: [
      socialUsername({ isReserved: (value) => value === "zeph" }),
      username(),
      {
        endpoints: {
          createFixtureUser: createAuthEndpoint(
            path,
            { method: "GET" },
            async (ctx) => {
              const user = await ctx.context.internalAdapter.createUser(
                {
                  email: "reddit@example.com",
                  name: "Reddit profile",
                  username: ctx.query?.username ?? "parazeeknova",
                },
                {
                  method: "oauth",
                  oauth: { profile: {}, providerId: "reddit" },
                }
              );
              return ctx.json(user);
            }
          ),
        },
        id: "social-username-test",
      },
    ],
    secret: "test-social-username-secret-at-least-32-characters",
    user: {
      additionalFields: { username: { required: true, type: "string" } },
    },
  });
  return { auth, rows };
}

describe("social username allocation before Better Auth validation", () => {
  test("creates a separate OAuth user on a collision without modifying the existing account", async () => {
    const { auth, rows } = fixture();
    const response = await auth.handler(
      new Request("http://localhost:3001/api/auth/callback/reddit")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: "reddit@example.com",
      username: "parazeeknova2",
    });
    expect(rows.user?.find((user) => user.id === "existing")).toMatchObject({
      email: "existing@example.com",
      username: "parazeeknova",
    });
    expect(rows.user).toHaveLength(2);
  });

  test("skips reserved handles and preserves the maximum username length", async () => {
    const { auth, rows } = fixture();
    const reserved = await auth.handler(
      new Request(
        "http://localhost:3001/api/auth/callback/reddit?username=zeph"
      )
    );
    expect(await reserved.json()).toMatchObject({ username: "zeph2" });
    const longName = "a".repeat(30);
    rows.user?.push({
      email: "long@example.com",
      id: "long",
      username: longName,
    });
    const long = await auth.handler(
      new Request(
        `http://localhost:3001/api/auth/callback/reddit?username=${longName}`
      )
    );
    expect(long.status).toBe(200);
    expect(await long.json()).toMatchObject({ username: `${"a".repeat(29)}2` });
  });

  test("leaves non-OAuth creation collisions rejected", async () => {
    const { auth, rows } = fixture("/fixture-user");
    const response = await auth.handler(
      new Request("http://localhost:3001/api/auth/fixture-user")
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "USERNAME_IS_ALREADY_TAKEN",
    });
    expect(rows.user).toHaveLength(1);
  });
});

test("short provider handles and heavily occupied base names still produce valid new usernames", async () => {
  const { auth, rows } = fixture();
  const short = await auth.handler(
    new Request("http://localhost:3001/api/auth/callback/reddit?username=a")
  );
  expect(short.status).toBe(200);
  expect(await short.json()).toMatchObject({ username: "a_user" });
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    rows.user?.push({
      email: `occupied-${suffix}@example.com`,
      id: `occupied-${suffix}`,
      username: `parazeeknova${suffix}`,
    });
  }
  const occupied = await auth.handler(
    new Request("http://localhost:3001/api/auth/callback/reddit")
  );
  expect(occupied.status).toBe(200);
  const created = (await occupied.json()) as { username: string };
  expect(created.username).toMatch(/^parazeeknova_[a-z0-9]{8}$/);
  expect(created.username.length).toBeLessThanOrEqual(30);
});
