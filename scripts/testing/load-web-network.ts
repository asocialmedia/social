// Run with bun --env-file=.env.test scripts/testing/load-web-network.ts --users=1000 --concurrency=32.
import { mkdir } from "node:fs/promises";

import { closePrisma, prisma, redis, toPrismaDateTime } from "@asm/db";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

const count = Number(
  Bun.argv.find((arg) => arg.startsWith("--users="))?.split("=")[1] ?? 1000
);
const concurrency = Number(
  Bun.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] ?? 32
);
const base = new URL(process.env.NETWORK_LOAD_URL ?? "http://localhost:3000");
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 5000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 128
)
  throw new Error("Invalid load bounds");
if (
  !["localhost", "127.0.0.1"].includes(base.hostname) ||
  !process.env.DATABASE_URL?.includes("localhost")
)
  throw new Error(
    "This workload requires the local development app and database"
  );
const run = crypto.randomUUID();
const followDid = process.env.NETWORK_LOAD_FOLLOW_DID;
if (
  followDid &&
  !(await prisma.orm.public.ExternalAuthors.where({
    did: followDid,
    status: "active",
  }).first())
)
  throw new Error(
    "The workload follow target must be an existing active external author"
  );
const cohorts = [["engineering"], ["software"], ["astronomy"], ["gardening"]];
const viewers = Array.from({ length: count }, (_, index) => ({
  id: `network-load-${run}-${index}`,
  follow: Boolean(followDid && index % 2 === 0),
  token: crypto.randomUUID() + crypto.randomUUID(),
  interests: cohorts[index % cohorts.length] ?? ["engineering"],
  ip: `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`,
}));
const paths = [
  "/api/network/preferences",
  "/api/posts/for-you?network=1&locale=en",
  "/api/posts/trending?network=1&locale=en",
  "/api/posts/latest?network=1&locale=en",
  "/api/protocols/bluesky/discover?mode=personalized&locale=en",
  "/api/protocols/bluesky/discover?mode=trending&locale=en",
  "/api/protocols/bluesky/discover?mode=latest&locale=en",
  "/api/protocols/bluesky/discover?mode=personalized&surface=explore&locale=en",
  "/api/protocols/bluesky/discover?mode=personalized&content=video&locale=en",
  "/api/gusts?mode=personalized&network=1&locale=en",
  "/api/posts/for-you?network=1&surface=explore&locale=en",
  "/api/posts/trending?network=1&surface=explore&locale=en",
  "/api/protocols/bluesky/discover?mode=trending&surface=explore&locale=en",
  "/api/gusts?mode=personalized&network=1&surface=explore&locale=en",
  "/api/protocols/bluesky/discover?mode=personalized&content=video&surface=explore&locale=en",
  "/api/recommendations/suggestions",
];
if (followDid) paths.push("/api/protocols/bluesky/following?locale=en");
const timings = new Map<string, number[]>();
const partialByPath = new Map<string, number>();
const emptyByPath = new Map<string, number>();
const errors: { path: string; status: number; error?: string }[] = [];
let requests = 0;
let partial = 0;
let empty = 0;
let completed = 0;
let next = 0;
const started = performance.now();
try {
  for (let offset = 0; offset < viewers.length; offset += 100) {
    const batch = viewers.slice(offset, offset + 100);
    // oxlint-disable-next-line no-await-in-loop -- bounded batches keep setup below the database parameter limit.
    await prisma.orm.public.Users.createAll(
      batch.map((viewer) => ({
        id: viewer.id,
        username: viewer.id,
        displayName: "Network load fixture",
        networkPreferences: {
          ...defaultNetworkPreferences(),
          language: "en",
          profiles: [
            { id: "default", name: "Load test", interests: viewer.interests },
          ],
        },
      }))
    );
    // oxlint-disable-next-line no-await-in-loop -- sessions reference the preceding committed users.
    await prisma.orm.public.Sessions.createAll(
      batch.map((viewer) => ({
        userId: viewer.id,
        token: viewer.token,
        expiresAt: toPrismaDateTime(new Date(Date.now() + 60 * 60_000)),
      }))
    );
    if (followDid) {
      const followedViewers = batch.filter((viewer) => viewer.follow);
      // oxlint-disable-next-line no-await-in-loop -- only fixture-owned edges are created after their users.
      await prisma.orm.public.ExternalFollows.createAll(
        followedViewers.map((viewer) => ({
          authorDid: followDid,
          userId: viewer.id,
        }))
      );
    }
  }
  console.log(JSON.stringify({ seededUsers: viewers.length, run }));
  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, async () => {
      while (next < viewers.length) {
        const viewer = viewers[next++];
        if (!viewer) break;
        for (const path of paths) {
          const at = performance.now();
          try {
            // oxlint-disable-next-line no-await-in-loop -- each virtual user visits the requested surfaces in order.
            const response = await fetch(new URL(path, base), {
              headers: {
                authorization: `Bearer ${viewer.token}`,
                "x-forwarded-for": viewer.ip,
                "cf-connecting-ip": viewer.ip,
              },
              signal: AbortSignal.timeout(30_000),
            });
            // oxlint-disable-next-line no-await-in-loop -- consume the response before the next request.
            const body = (await response.json()) as {
              error?: string;
              partial?: boolean;
              items?: unknown[];
              posts?: unknown[];
              preferences?: { profiles: { interests: string[] }[] };
            };
            const elapsed = performance.now() - at;
            const values = timings.get(path) ?? [];
            values.push(elapsed);
            timings.set(path, values);
            requests += 1;
            if (!response.ok)
              errors.push({ path, status: response.status, error: body.error });
            if (
              path === "/api/network/preferences" &&
              response.ok &&
              JSON.stringify(body.preferences?.profiles[0]?.interests) !==
                JSON.stringify(viewer.interests)
            )
              errors.push({
                path,
                status: 0,
                error: "Authenticated persona mismatch",
              });
            if (body.partial) {
              partial += 1;
              partialByPath.set(path, (partialByPath.get(path) ?? 0) + 1);
            }
            if ((body.items ?? body.posts)?.length === 0) {
              empty += 1;
              emptyByPath.set(path, (emptyByPath.get(path) ?? 0) + 1);
            }
          } catch (error) {
            requests += 1;
            errors.push({
              path,
              status: 0,
              error: error instanceof Error ? error.message : "request failed",
            });
          }
        }
        completed += 1;
        if (completed % 100 === 0)
          console.log(
            JSON.stringify({ completed, requests, errors: errors.length })
          );
      }
    })
  );
  const percentile = (values: number[], fraction: number) =>
    Math.round(
      values.toSorted((a, b) => a - b)[
        Math.min(values.length - 1, Math.floor(values.length * fraction))
      ] ?? 0
    );
  const report = {
    at: new Date().toISOString(),
    environment: `${process.env.NETWORK_LOAD_RUNTIME ?? "development"} Next.js server, real Postgres/Redis/auth and live shared Bluesky retrieval`,
    baseUrl: base.origin,
    simulatedIngressIps: true,
    users: count,
    usersWithExternalFollow: viewers.filter((viewer) => viewer.follow).length,
    followedActor: followDid ?? null,
    concurrency,
    requests,
    elapsedMs: Math.round(performance.now() - started),
    partialResponses: partial,
    emptyResponses: empty,
    failures: errors.length,
    errorCounts: Object.fromEntries(
      [
        ...new Set(
          errors.map(
            (error) => `${error.status}:${error.path}:${error.error ?? ""}`
          )
        ),
      ].map((key) => [
        key,
        errors.filter(
          (error) =>
            `${error.status}:${error.path}:${error.error ?? ""}` === key
        ).length,
      ])
    ),
    errors: errors.slice(0, 40),
    paths: [...timings].map(([path, values]) => ({
      path,
      partialResponses: partialByPath.get(path) ?? 0,
      emptyResponses: emptyByPath.get(path) ?? 0,
      requests: values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      p99Ms: percentile(values, 0.99),
    })),
  };
  await mkdir("artifacts/network-validation", { recursive: true });
  await Bun.write(
    `artifacts/network-validation/load-${run}.json`,
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await prisma.orm.public.Users.where((user) =>
    user.id.in(viewers.map((viewer) => viewer.id))
  ).deleteAndCount();
  let cursor = "0";
  do {
    // oxlint-disable-next-line no-await-in-loop -- SCAN advances its opaque cursor.
    const result = await redis.scan(cursor, "MATCH", `*${run}*`, "COUNT", 1000);
    cursor = result[0];
    // oxlint-disable-next-line no-await-in-loop -- remove only this run's fixture cache keys.
    if (result[1].length) await redis.del(...result[1]);
  } while (cursor !== "0");
  await closePrisma();
  redis.disconnect();
}
