// Reads the constraints out of a Prisma `where` predicate.
//
// A mocked table is handed a FUNCTION, not a value: `where((user) => user.id.in(ids))`.
// There is no way to look inside it, so a mock that wants to answer "which rows would
// match" has to call it - and the column accessors it is called with are the only place
// the constraint shows up.
//
// So the predicate is invoked against recording accessors and what it touched is
// returned. The point is that a mock then answers from the query the route ACTUALLY
// expressed rather than from a guess about which branch called it, which is what makes a
// double able to catch a reintroduced check instead of merely not crashing.
//
// Returned keys are plain column names for comparisons and `column:isNull` /
// `column:isNotNull` for the null checks, so a mock can compare a whole row's shape in
// one expression.

export type ProbedWhere = Record<string, unknown>;

export function probeWhere(predicate: unknown, columns: string[]): ProbedWhere {
  const seen: ProbedWhere = {};
  const accessors: Record<string, unknown> = {};

  for (const column of columns) {
    accessors[column] = {
      asc: () => "asc",
      desc: () => "desc",
      eq: (value: unknown) => {
        seen[column] = value;
        return {};
      },
      in: (value: unknown) => {
        seen[column] = value;
        return {};
      },
      isNotNull: () => {
        seen[`${column}:isNotNull`] = true;
        return {};
      },
      isNull: () => {
        seen[`${column}:isNull`] = true;
        return {};
      },
    };
  }

  (predicate as (value: unknown) => unknown)(accessors);

  return seen;
}

// The id list out of a probed `column.in(...)` constraint.
//
// Narrowed here rather than at each call site because the shape the accessors hand back
// is the mock's business: this returns a plain string array, and a caller that has to
// know about `{ in: { values } }` nesting has been coupled to the double rather than to
// the query.
export function probedIds(probed: ProbedWhere, column = "id"): string[] {
  const constraint = probed[column];
  if (Array.isArray(constraint)) {
    return constraint as string[];
  }
  if (
    typeof constraint === "object" &&
    constraint !== null &&
    "in" in constraint
  ) {
    const inner = (constraint as { in?: { values?: unknown } }).in;
    if (Array.isArray(inner?.values)) {
      return inner.values as string[];
    }
  }
  return [];
}
