import inspectionSql from "./sql/postgres-inspection.sql" with { type: "text" };

// These container probes run before the app contract and runtime are available.
export function postgresInspectionQuery(
  name: "schemaReady" | "extensions",
  source = inspectionSql
): string {
  const marker = `// query: development.${name}\n`;
  const start = source.indexOf(marker);
  if (start < 0)
    throw new RangeError(`Missing Postgres inspection query ${name}`);
  const statementStart = start + marker.length;
  const nextSection = source.indexOf("// query: ", statementStart);
  const statement = source
    .slice(statementStart, nextSection < 0 ? undefined : nextSection)
    .trim();
  if (!statement)
    throw new RangeError(`Empty Postgres inspection query ${name}`);
  return statement;
}
