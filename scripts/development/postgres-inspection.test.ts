import { expect, test } from "bun:test";

import { postgresInspectionQuery } from "./postgres-inspection";

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
