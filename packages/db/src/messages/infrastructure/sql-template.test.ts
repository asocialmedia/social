import { describe, expect, test } from "bun:test";

import { readSqlBundle, renderSql } from "./sql-template";

describe("SQL bundles", () => {
  test("loads related statements and preserves fragment whitespace and placeholders", () => {
    const queries = readSqlBundle(
      "// query: reads.isolation\nSET TRANSACTION READ ONLY\n// query: reads.predicate\n AND id = $1 \n// query: writes.insert\nINSERT INTO messages VALUES ($1)\n\n",
      { reads: ["isolation", "predicate"], writes: ["insert"] }
    );
    expect(queries.reads.isolation).toBe("SET TRANSACTION READ ONLY");
    expect(queries.reads.predicate).toBe(" AND id = $1 ");
    expect(queries.writes.insert).toBe("INSERT INTO messages VALUES ($1)\n");
  });

  test("rejects duplicate sections", () => {
    expect(() =>
      readSqlBundle(
        "// query: reads.query\nSELECT 1\n// query: reads.query\nSELECT 2\n",
        { reads: ["query"] }
      )
    ).toThrow("Duplicate SQL bundle section reads.query");
  });

  test("rejects missing and unregistered sections", () => {
    const source = "// query: reads.query\nSELECT 1\n";
    expect(() => readSqlBundle(source, { reads: ["missing"] })).toThrow(
      "Missing SQL bundle section reads.missing"
    );
    expect(() => readSqlBundle(source, { reads: [] })).toThrow(
      "Unexpected SQL bundle section reads.query"
    );
  });

  test("rejects unsectioned SQL and an incomplete section delimiter", () => {
    expect(() => readSqlBundle("SELECT 1", { reads: ["query"] })).toThrow(
      "SQL bundle must start with a query section"
    );
    expect(() =>
      readSqlBundle("// query: reads.query\nSELECT 1", { reads: ["query"] })
    ).toThrow("SQL bundle section reads.query must end with a newline");
  });
});

describe("internal SQL templates", () => {
  test("fills repeated syntax slots while leaving positional values for Prisma", () => {
    expect(
      renderSql(
        'SELECT id FROM messages WHERE "createdAt" {{comparison}} $1 ORDER BY id {{direction}}, "createdAt" {{direction}}',
        { comparison: ">", direction: "ASC" }
      )
    ).toBe(
      'SELECT id FROM messages WHERE "createdAt" > $1 ORDER BY id ASC, "createdAt" ASC'
    );
  });

  test("supports generated placeholder offsets and empty optional predicates", () => {
    expect(
      renderSql(["WHERE id = $", "{{offset}} {{predicate}}"].join(""), {
        offset: 12,
        predicate: "",
      })
    ).toBe("WHERE id = $12 ");
  });

  test("does not recursively substitute markers inside supplied SQL fragments", () => {
    expect(renderSql("{{nested}}", { nested: "{{unexpanded}}" })).toBe(
      "{{unexpanded}}"
    );
  });

  test("rejects a missing fragment instead of silently removing a query predicate", () => {
    expect(() => renderSql("WHERE id {{comparison}} $1", {})).toThrow(
      "Missing SQL template fragment comparison"
    );
  });
});
