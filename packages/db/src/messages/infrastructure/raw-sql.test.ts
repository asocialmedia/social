import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { rawExecutePlan, rawParams, rawQueryPlan } from "./raw-sql";

function parametersOf(plan: ReturnType<typeof rawQueryPlan>) {
  return plan.ast?.collectParamRefs().map((reference) => ({
    codecId: reference.codec?.codecId,
    ...(reference.codec?.many ? { many: true } : {}),
    value: "value" in reference ? reference.value : undefined,
  }));
}

describe("Prisma 8 positional SQL plans", () => {
  test("accepts parameters from a separate server bundle sharing the Prisma singleton", async () => {
    const bundle = await Bun.build({
      entrypoints: [fileURLToPath(import.meta.resolve("./raw-sql"))],
      format: "esm",
      target: "bun",
    });
    expect(bundle.success).toBe(true);
    const [output] = bundle.outputs;
    if (!output) {
      throw new Error("Missing raw SQL bundle");
    }
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(await output.text()).toString("base64")}`;
    const bundled: { rawQueryPlan: typeof rawQueryPlan } = await import(
      moduleUrl
    );
    const plan = bundled.rawQueryPlan(
      "SELECT $1::text AS id, to_jsonb($2::text[]) AS ids, $3::jsonb AS payload",
      [
        { codecId: "pg/text@1", value: null },
        { codecId: "pg/text@1", many: true, value: ["one", "two"] },
        { codecId: "pg/jsonb@1", value: { id: "fixture" } },
      ],
      {
        id: { codecId: "pg/text@1", nullable: true },
        ids: "pg/jsonb@1",
        payload: "pg/jsonb@1",
      }
    );
    expect(parametersOf(plan)).toEqual([
      { codecId: "pg/text@1", value: null },
      { codecId: "pg/text@1", many: true, value: ["one", "two"] },
      { codecId: "pg/jsonb@1", value: { id: "fixture" } },
    ]);
  });

  test("binds repeated, reordered, and multi-digit placeholders without inserting values into SQL", () => {
    const unsafeText = "'); DROP TABLE messages; --";
    const values = Array.from(
      { length: 12 },
      (_, index) => `value-${index + 1}`
    );
    values[11] = unsafeText;
    const plan = rawQueryPlan(
      "SELECT $12::text AS last, $2::text AS second, $12::text AS repeated",
      rawParams(values),
      { last: "pg/text@1", repeated: "pg/text@1", second: "pg/text@1" }
    );
    expect(parametersOf(plan)).toEqual([
      { codecId: "pg/text@1", value: unsafeText },
      { codecId: "pg/text@1", value: "value-2" },
      { codecId: "pg/text@1", value: unsafeText },
    ]);
    expect(plan.meta.lane).toBe("raw");
    if (plan.ast?.kind !== "raw-query") {
      throw new TypeError("Expected a raw query AST");
    }
    expect(
      plan.ast.parts.filter((part) => typeof part === "string").join("")
    ).not.toContain(unsafeText);
  });

  test("rejects missing or invalid placeholder indices before execution", () => {
    for (const sql of [
      "SELECT $0",
      "SELECT $2",
      "SELECT $999999999999999999999",
    ]) {
      expect(() => rawExecutePlan(sql, rawParams(["only"]))).toThrow(
        "Missing raw SQL parameter"
      );
    }
  });

  test("keeps native array casts and scalar parameter encodings", () => {
    const date = new Date("2026-10-11T01:02:03.456Z");
    const values = rawParams([
      [1, 2],
      [],
      ["quote'", "comma,"],
      date,
      null,
      true,
      5,
    ]);
    expect(values).toEqual([
      { codecId: "pg/text@1", many: true, value: ["1", "2"] },
      { codecId: "pg/text@1", many: true, value: [] },
      { codecId: "pg/text@1", many: true, value: ["quote'", "comma,"] },
      { codecId: "pg/text@1", value: date.toISOString() },
      { codecId: "pg/text@1", value: null },
      { codecId: "pg/bool@1", value: true },
      { codecId: "pg/text@1", value: 5 },
    ]);
    expect(() => rawParams([undefined])).toThrow(
      "Unsupported raw SQL parameter"
    );
    expect(() => rawParams([[{}]])).toThrow(
      "Raw SQL arrays must contain strings or numbers"
    );
  });

  test("declares nullable timestamps and explicit JSON codecs on row plans", () => {
    const plan = rawQueryPlan(
      "SELECT $1::jsonb AS payload, NULL::timestamp AS stamp",
      [{ codecId: "pg/jsonb@1", value: [{ id: "fixture" }] }],
      {
        payload: "pg/jsonb@1",
        stamp: { codecId: "pg/timestamp-string@1", nullable: true },
      }
    );
    expect(parametersOf(plan)).toEqual([
      { codecId: "pg/jsonb@1", value: [{ id: "fixture" }] },
    ]);
    if (plan.ast?.kind !== "raw-query") {
      throw new TypeError("Expected a raw query AST");
    }
    expect(plan.ast.result).toEqual({
      columns: {
        payload: { codecId: "pg/jsonb@1", nullable: false },
        stamp: { codecId: "pg/timestamp-string@1", nullable: true },
      },
      kind: "rows",
    });
  });
});
