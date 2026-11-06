import { expect, test } from "bun:test";

import { postgresInspectionQuery } from "./postgres-inspection";

test.each(["\n", "\r\n"])("reads probes with %j line endings", (newline) => {
  const source = [
    "// query: development.schemaReady",
    "SELECT 1;",
    "",
    "// query: development.extensions",
    "SELECT extname",
    "FROM pg_extension;",
  ].join(newline);

  expect(postgresInspectionQuery("schemaReady", source)).toBe("SELECT 1;");
  expect(postgresInspectionQuery("extensions", source)).toBe(
    "SELECT extname\nFROM pg_extension;"
  );
});

test("bootstrap probes remain independent and contain no bundle metadata", () => {
  const schema = postgresInspectionQuery("schemaReady");
  const extensions = postgresInspectionQuery("extensions");
  expect(schema).toContain("information_schema.tables");
  expect(schema).not.toContain("pg_extension");
  expect(extensions).toContain("pg_extension");
  expect(extensions).not.toContain("information_schema");
  for (const query of [schema, extensions])
    expect(query).not.toContain("// query:");
});

test("bootstrap refuses a missing or empty probe instead of running an empty psql command", () => {
  expect(() => postgresInspectionQuery("schemaReady", "")).toThrow(
    "Missing Postgres inspection query"
  );
  expect(() =>
    postgresInspectionQuery(
      "schemaReady",
      "// query: development.schemaReady\n"
    )
  ).toThrow("Empty Postgres inspection query");
});
