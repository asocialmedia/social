import { rawExecute, rawQuery } from "../messages/infrastructure/raw-sql";
import { renderSql } from "../messages/infrastructure/sql-template";
import prisma, { toPrismaDateTime } from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { accountResolutionSql } from "./account-resolution-queries";

const prefix = "account-resolution:";

export async function createAccountResolutionState(
  id: string,
  userId: string,
  value: string,
  expiresAt: Date
) {
  await prisma.orm.public.Verification.create({
    expiresAt: toPrismaDateTime(expiresAt),
    id,
    identifier: `${prefix}${id}`,
    userId,
    value,
  });
}

export async function readAccountResolutionState(
  id: string,
  transaction?: PrismaTransaction
) {
  const result = await rawQuery<{ value: string }>(
    renderSql(accountResolutionSql.state.read, {
      lock: transaction ? " FOR UPDATE" : "",
    }),
    [id, `${prefix}${id}`],
    { value: "pg/text@1" },
    transaction
  );
  return result.rows[0]?.value ?? null;
}

// Compare-and-swap prevents concurrent verification requests from reviving consumed proofs.
export async function updateAccountResolutionState(
  id: string,
  previous: string,
  value: string,
  transaction?: PrismaTransaction
) {
  const result = await rawExecute(
    accountResolutionSql.state.update,
    [id, previous, value, `${prefix}${id}`],
    transaction
  );
  return result.affectedRows === 1;
}

export async function deleteAccountResolutionState(
  id: string,
  transaction?: PrismaTransaction
) {
  await rawExecute(
    accountResolutionSql.state.delete,
    [id, `${prefix}${id}`],
    transaction
  );
}
