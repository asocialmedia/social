import type { AffectedCount } from "@prisma/orm-postgres/relational-core/expression";
import { param } from "@prisma/orm-postgres/relational-core/expression";
import type { SqlQueryPlan } from "@prisma/orm-postgres/relational-core/plan";

import { fromPrismaDateTime } from "../../dates";
import prisma from "../../prisma";
import type { PrismaTransaction } from "../../prisma";

export interface RawParam {
  codecId: string;
  value: unknown;
}

type RawBuilder = ReturnType<typeof prisma.raw.sql>;
type RawRowSpecEntry = Parameters<RawBuilder["returnsRow"]>[0][string];

export type RowSpec<Row extends object> = {
  readonly [Column in keyof Row]-?: RawRowSpecEntry;
};

// Preserve Postgres's contextual scalar inference and existing explicit casts.
// Arrays use the registered text-array codec; an existing ::int[] cast follows it.
export function rawParams(values: readonly unknown[]): RawParam[] {
  return values.map((value) => {
    if (Array.isArray(value)) {
      if (
        !value.every(
          (element) =>
            typeof element === "string" || typeof element === "number"
        )
      ) {
        throw new TypeError("Raw SQL arrays must contain strings or numbers");
      }
      return { codecId: "pg/text-array@1", value: value.map(String) };
    }
    if (value instanceof Date) {
      return { codecId: "pg/text@1", value: value.toISOString() };
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number"
    ) {
      return { codecId: "pg/text@1", value };
    }
    if (typeof value === "boolean") {
      return { codecId: "pg/bool@1", value };
    }
    throw new TypeError("Unsupported raw SQL parameter");
  });
}

// Internal SQL only: quoted literals and dollar-quoted bodies must not contain $N text.
// Positional parameters stay outside those bodies; values never enter SQL text.
export function rawStatement(
  sql: string,
  parameters: readonly RawParam[]
): RawBuilder {
  const segments: string[] = [];
  const expressions: ReturnType<typeof param>[] = [];
  let offset = 0;
  for (const match of sql.matchAll(/\$(?<index>\d+)/g)) {
    const index = Number(match.groups?.index);
    const parameter = parameters[index - 1];
    if (!Number.isSafeInteger(index) || index < 1 || !parameter) {
      throw new RangeError(`Missing raw SQL parameter $${match.groups?.index}`);
    }
    segments.push(sql.slice(offset, match.index));
    expressions.push(param(parameter.value, { codecId: parameter.codecId }));
    offset = match.index + match[0].length;
  }
  segments.push(sql.slice(offset));
  const template = Object.assign(segments, { raw: [...segments] });
  return prisma.raw.sql(template, ...expressions);
}

export function rawQueryPlan<Row extends object>(
  sql: string,
  parameters: readonly RawParam[],
  spec: RowSpec<Row>
): SqlQueryPlan<Record<string, unknown>> {
  return rawStatement(sql, parameters).returnsRow(spec).build();
}

export function rawExecutePlan(
  sql: string,
  parameters: readonly RawParam[]
): SqlQueryPlan<AffectedCount> {
  return rawStatement(sql, parameters).affectedCount().build();
}

export async function rawQuery<Row extends object>(
  sql: string,
  values: readonly unknown[],
  spec: RowSpec<Row>,
  transaction?: PrismaTransaction
): Promise<{ rows: Row[] }> {
  const plan = rawQueryPlan(sql, rawParams(values), spec);
  const rows = await (transaction
    ? transaction.query(plan)
    : prisma.runtime().query(plan));
  // Raw specs describe database codecs; public message interfaces still use Date.
  return {
    rows: rows.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([column, value]) => {
            const entry = spec[column as keyof Row];
            const codecId = typeof entry === "string" ? entry : entry.codecId;
            return [
              column,
              value !== null &&
              (codecId === "pg/timestamp-string@1" ||
                codecId === "pg/timestamp-temporal@1")
                ? fromPrismaDateTime(value)
                : value,
            ];
          })
        ) as Row
    ),
  };
}

export async function rawExecute(
  sql: string,
  values: readonly unknown[] = [],
  transaction?: Pick<PrismaTransaction, "execute">
): Promise<{ affectedRows: number }> {
  const plan = rawExecutePlan(sql, rawParams(values));
  return await (transaction
    ? transaction.execute(plan)
    : prisma.runtime().execute(plan));
}
