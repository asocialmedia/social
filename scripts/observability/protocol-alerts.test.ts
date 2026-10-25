import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

const requestFailed = "Protocol request failed";
const warmupFailed = "Discovery inventory warmup failed";
const workerUnavailable =
  "Protocol read worker unavailable; trying available capacity";

test("protocol degradation alerts count terminal service failures while retaining independent ERROR alerts", async () => {
  const database = new Database(":memory:");
  try {
    database.run(
      "CREATE TABLE asm_protocols_logs (_timestamp INTEGER, severity TEXT, body TEXT, operation TEXT, code TEXT)"
    );
    const insert = database.query(
      "INSERT INTO asm_protocols_logs VALUES (?, ?, ?, ?, ?)"
    );
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
    const sql = await Bun.file(
      new URL("./sql/protocols-degraded.sql", import.meta.url)
    ).text();
    const matching = database.query<{ _timestamp: number }, []>(sql).all();
    expect(
      matching.map((row) => row._timestamp).toSorted((a, b) => a - b)
    ).toEqual(
      cases.flatMap((fixture, index) => (fixture.alerts ? [index] : []))
    );
    expect(
      database
        .query(
          "SELECT body FROM asm_protocols_logs WHERE severity IN ('ERROR', 'FATAL')"
        )
        .all()
    ).toHaveLength(2);
  } finally {
    database.close();
  }
});
