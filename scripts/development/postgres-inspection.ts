import inspectionSql from "./sql/postgres-inspection.sql" with { type: "text" };

// These container probes run before the app contract and runtime are available.
export function postgresInspectionQuery(
  name: "schemaReady" | "extensions",
  source = inspectionSql
): string {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const marker = `// query: development.${name}\n`;
  const start = normalizedSource.indexOf(marker);
  if (start < 0)
    throw new RangeError(`Missing Postgres inspection query ${name}`);
  const statementStart = start + marker.length;
  const nextSection = normalizedSource.indexOf("// query: ", statementStart);
  const statement = normalizedSource
    .slice(statementStart, nextSection < 0 ? undefined : nextSection)
    .trim();
  if (!statement)
    throw new RangeError(`Empty Postgres inspection query ${name}`);
  return statement;
}
