import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import correlateQuery from "./sql/fixtures/protocol-alerts-correlate.sql" with { type: "text" };
import errorQuery from "./sql/fixtures/protocol-alerts-errors.sql" with { type: "text" };
import insertQuery from "./sql/fixtures/protocol-alerts-insert.sql" with { type: "text" };
import schemaQuery from "./sql/fixtures/protocol-alerts-schema.sql" with { type: "text" };
import degradedQuery from "./sql/protocols-degraded.sql" with { type: "text" };
import workerDegradedQuery from "./sql/protocols-worker-degraded.sql" with { type: "text" };

const requestFailed = "Protocol request failed";
const warmupFailed = "Discovery inventory warmup failed";
const workerUnavailable =
  "Protocol read worker unavailable; trying available capacity";

test.each([
  degradedQuery,
  workerDegradedQuery.replaceAll(
    "asm_protocols_us_east_logs",
    "asm_protocols_logs"
  ),
])(
  "correlated retries count once while distinct and uncorrelated failures remain visible",
  (query) => {
    const database = new Database(":memory:");
    try {
      database.run(schemaQuery);
      const insert = database.query(insertQuery);
      for (let index = 0; index < 5; index += 1) {
        insert.run(
          index,
          "WARN",
          requestFailed,
          "bluesky.author_feed",
          "unavailable"
        );
      }
      database.run(correlateQuery, ["same-request", null, null]);
      insert.run(5, "WARN", requestFailed, "bluesky.author_feed", "capacity");
      database.run(correlateQuery, ["same-request", 5, 5]);
      insert.run(
        6,
        "WARN",
        requestFailed,
        "bluesky.author_feed",
        "unavailable"
      );
      insert.run(
        7,
        "WARN",
        requestFailed,
        "bluesky.author_feed",
        "unavailable"
      );
      insert.run(8, "WARN", requestFailed, "bluesky.posts", "unavailable");
      database.run(correlateQuery, ["different-request", 6, 6]);
      database.run(correlateQuery, ["same-request", 8, 8]);
      insert.run(
        9,
        "WARN",
        requestFailed,
        "bluesky.author_feed",
        "unavailable"
      );
      database.run(correlateQuery, ["", 9, 9]);
      const matches = database.query<{ _timestamp: number }, []>(query).all();
      expect(matches.map((row) => row._timestamp)).toEqual([9, 8, 7, 6, 5]);
    } finally {
      database.close();
    }
  }
);

test("protocol degradation alerts count terminal service failures while retaining independent ERROR alerts", () => {
  const database = new Database(":memory:");
  try {
    database.run(schemaQuery);
    const insert = database.query(insertQuery);
    const cases = [
      {
        body: requestFailed,
        operation: "bluesky.discover",
        code: "unavailable",
        alerts: true,
      },
      {
        body: requestFailed,
        operation: "bluesky.search",
        code: "capacity",
        alerts: true,
      },
      {
        body: workerUnavailable,
        operation: "app.bsky.feed.getFeed",
        code: null,
        alerts: true,
      },
      { body: warmupFailed, operation: null, code: null, alerts: true },
      {
        body: warmupFailed,
        operation: null,
        code: "invalid_response",
        alerts: true,
      },
      {
        body: "Protocol upstream request failed",
        operation: "app.bsky.feed.getFeed",
        code: "unavailable",
        alerts: false,
      },
      {
        body: requestFailed,
        operation: "ingestion.hydrate",
        code: "unavailable",
        alerts: false,
      },
      {
        body: warmupFailed,
        operation: null,
        code: "unavailable",
        alerts: false,
      },
      { body: warmupFailed, operation: null, code: "capacity", alerts: false },
      {
        body: warmupFailed,
        operation: null,
        code: "rate_limited",
        alerts: false,
      },
      { body: warmupFailed, operation: null, code: "timeout", alerts: false },
      {
        body: requestFailed,
        operation: "bluesky.discover",
        code: "invalid_input",
        alerts: false,
      },
      {
        body: requestFailed,
        operation: "bluesky.feed",
        code: "restricted",
        alerts: false,
      },
      {
        body: requestFailed,
        operation: "bluesky.posts",
        code: "cancelled",
        alerts: false,
      },
    ];
    for (const [index, fixture] of cases.entries()) {
      insert.run(index, "WARN", fixture.body, fixture.operation, fixture.code);
    }
    insert.run(100, "ERROR", "Protocol HTTP handler failed", null, "internal");
    insert.run(101, "FATAL", "Process failed", null, "internal");
    const matching = database
      .query<{ _timestamp: number }, []>(degradedQuery)
      .all();
    expect(
      matching.map((row) => row._timestamp).toSorted((a, b) => a - b)
    ).toEqual(
      cases.flatMap((fixture, index) => (fixture.alerts ? [index] : []))
    );
    expect(database.query(errorQuery).all()).toHaveLength(2);
  } finally {
    database.close();
  }
});

test("worker degradation counts transport failures once and leaves optional generator failures to the coordinator", async () => {
  const database = new Database(":memory:");
  try {
    database.run(
      schemaQuery.replaceAll("asm_protocols_logs", "asm_protocols_us_east_logs")
    );
    const insert = database.query(
      insertQuery.replaceAll("asm_protocols_logs", "asm_protocols_us_east_logs")
    );
    const cases = [
      {
        body: "Protocol upstream request failed",
        operation: "worker.transport.app.bsky.actor.getProfile",
        code: "unavailable",
        alerts: true,
      },
      {
        body: "Protocol upstream request failed",
        operation: "worker.transport.app.bsky.feed.getPosts",
        code: "unavailable",
        alerts: true,
      },
      {
        body: "Protocol upstream request failed",
        operation: "worker.transport.app.bsky.feed.searchPosts",
        code: "rate_limited",
        alerts: true,
      },
      {
        body: "Protocol upstream request failed",
        operation: "worker.transport.app.bsky.feed.getFeed",
        code: "unavailable",
        alerts: false,
      },
      {
        body: "Protocol upstream request failed",
        operation: "app.bsky.actor.getProfile",
        code: "unavailable",
        alerts: false,
      },
      {
        body: "Protocol upstream request failed",
        operation: "content_visibility",
        code: "unavailable",
        alerts: false,
      },
      {
        body: requestFailed,
        operation: "ingestion.hydrate",
        code: "unavailable",
        alerts: false,
      },
      {
        body: requestFailed,
        operation: "worker.app.bsky.actor.getProfile",
        code: "unavailable",
        alerts: true,
      },
      {
        body: "Protocol upstream request failed",
        operation: "worker.transport.app.bsky.feed.searchPosts",
        code: "restricted",
        alerts: false,
      },
      {
        body: workerUnavailable,
        operation: "worker.app.bsky.feed.getPosts",
        code: null,
        alerts: true,
      },
    ];
    for (const [index, fixture] of cases.entries()) {
      insert.run(index, "WARN", fixture.body, fixture.operation, fixture.code);
    }
    insert.run(100, "ERROR", "Protocol HTTP handler failed", null, "internal");
    expect(
      database
        .query(
          errorQuery.replaceAll(
            "asm_protocols_logs",
            "asm_protocols_us_east_logs"
          )
        )
        .all()
    ).toHaveLength(1);
    const sql = await Bun.file(
      new URL("./sql/protocols-worker-degraded.sql", import.meta.url)
    ).text();
    expect(
      database
        .query<{ _timestamp: number }, []>(sql)
        .all()
        .map((row) => row._timestamp)
        .toSorted((a, b) => a - b)
    ).toEqual(
      cases.flatMap((fixture, index) => (fixture.alerts ? [index] : []))
    );
  } finally {
    database.close();
  }
});
