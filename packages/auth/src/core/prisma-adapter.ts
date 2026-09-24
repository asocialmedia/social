import type { PrismaClient, PrismaOrm } from "@asm/db";
import { and, fromPrismaDateTime, prisma, toPrismaDateTime } from "@asm/db";
import type { BetterAuthOptions } from "better-auth";
import type {
  CleanedWhere,
  CustomAdapter,
  DBAdapter,
  DBTransactionAdapter,
  JoinConfig,
} from "better-auth/adapters";
import { createAdapterFactory } from "better-auth/adapters";

type AuthModel = "account" | "jwks" | "session" | "user" | "verification";
type AuthExpression = Parameters<typeof and>[number];
type AuthRecord = Record<string, unknown>;

interface DynamicField {
  eq: (value: unknown) => AuthExpression;
  ilike?: (value: string) => AuthExpression;
  in: (values: readonly unknown[]) => AuthExpression;
  isNotNull: () => AuthExpression;
  isNull: () => AuthExpression;
  like: (value: string) => AuthExpression;
  lt: (value: unknown) => AuthExpression;
  lte: (value: unknown) => AuthExpression;
  gt: (value: unknown) => AuthExpression;
  gte: (value: unknown) => AuthExpression;
  neq: (value: unknown) => AuthExpression;
  notIn: (values: readonly unknown[]) => AuthExpression;
}

interface DynamicCollection {
  aggregate: (
    select: (aggregate: { count: () => number }) => AuthRecord
  ) => Promise<AuthRecord>;
  all: () => Promise<AuthRecord[]>;
  create: (data: AuthRecord) => Promise<AuthRecord>;
  cursor: (value: AuthRecord) => DynamicCollection;
  delete: () => Promise<AuthRecord | null>;
  deleteAndCount: () => Promise<number>;
  first: () => Promise<AuthRecord | null>;
  include: (
    relation: string,
    select: (collection: DynamicCollection) => unknown
  ) => DynamicCollection;
  limit: (value: number) => DynamicCollection;
  offset: (value: number) => DynamicCollection;
  orderBy: (select: (model: object) => unknown) => DynamicCollection;
  select: (...fields: string[]) => DynamicCollection;
  update: (data: AuthRecord) => Promise<AuthRecord | null>;
  updateAndCount: (data: AuthRecord) => Promise<number>;
  where: (
    predicate: ((model: object) => AuthExpression) | AuthRecord
  ) => DynamicCollection;
}

interface AdapterContext {
  orm: PrismaOrm;
  transaction: PrismaClient["transaction"];
}

const AUTH_MODELS: Record<string, AuthModel> = {
  account: "account",
  jwks: "jwks",
  session: "session",
  user: "user",
  verification: "verification",
};

function authModel(model: string): AuthModel {
  const resolved = AUTH_MODELS[model];
  if (!resolved) {
    throw new Error(`Unsupported Better Auth model: ${model}`);
  }
  return resolved;
}

function modelCollection(orm: PrismaOrm, model: AuthModel): DynamicCollection {
  switch (model) {
    case "account": {
      return orm.public.Accounts as unknown as DynamicCollection;
    }
    case "jwks": {
      return orm.public.Jwks as unknown as DynamicCollection;
    }
    case "session": {
      return orm.public.Sessions as unknown as DynamicCollection;
    }
    case "user": {
      return orm.public.Users as unknown as DynamicCollection;
    }
    case "verification": {
      return orm.public.Verification as unknown as DynamicCollection;
    }
    default: {
      throw new Error(`Unsupported Better Auth model: ${model}`);
    }
  }
}

function isDynamicField(value: unknown): value is DynamicField {
  return (
    typeof value === "object" &&
    value !== null &&
    "eq" in value &&
    typeof value.eq === "function"
  );
}

function dynamicField(model: object, field: string): DynamicField {
  const value: unknown = Reflect.get(model, field);
  if (!isDynamicField(value)) {
    throw new Error(`Unknown Better Auth field: ${field}`);
  }
  return value;
}

function normalizedValue(value: unknown): unknown {
  return value instanceof Date ? toPrismaDateTime(value) : value;
}

function toPrismaData(value: unknown): unknown {
  if (value instanceof Date) {
    return toPrismaDateTime(value);
  }
  if (Array.isArray(value)) {
    return value.map(toPrismaData);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toPrismaData(entry)])
    );
  }
  return value;
}

function fromPrismaData(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "toZonedDateTime" in value
  ) {
    return fromPrismaDateTime(value);
  }
  if (Array.isArray(value)) {
    return value.map(fromPrismaData);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, fromPrismaData(entry)])
    );
  }
  return value;
}

function whereExpression(model: object, where: CleanedWhere[]): AuthExpression {
  const expressions = where.map((condition) => {
    const field = dynamicField(model, condition.field);
    const value = normalizedValue(condition.value);
    switch (condition.operator) {
      case "eq": {
        return value === null ? field.isNull() : field.eq(value);
      }
      case "ne": {
        return value === null ? field.isNotNull() : field.neq(value);
      }
      case "lt": {
        return field.lt(value);
      }
      case "lte": {
        return field.lte(value);
      }
      case "gt": {
        return field.gt(value);
      }
      case "gte": {
        return field.gte(value);
      }
      case "in": {
        return field.in(Array.isArray(value) ? value : []);
      }
      case "not_in": {
        return field.notIn(Array.isArray(value) ? value : []);
      }
      case "contains": {
        const pattern = `%${String(value)}%`;
        return condition.mode === "insensitive" && field.ilike
          ? field.ilike(pattern)
          : field.like(pattern);
      }
      case "starts_with": {
        const pattern = `${String(value)}%`;
        return condition.mode === "insensitive" && field.ilike
          ? field.ilike(pattern)
          : field.like(pattern);
      }
      case "ends_with": {
        const pattern = `%${String(value)}`;
        return condition.mode === "insensitive" && field.ilike
          ? field.ilike(pattern)
          : field.like(pattern);
      }
      default: {
        throw new Error(
          `Unsupported Better Auth operator: ${condition.operator}`
        );
      }
    }
  });
  return and(...expressions);
}

function whereBranches(where: CleanedWhere[] | undefined): CleanedWhere[][] {
  if (!where || where.length === 0) {
    return [[]];
  }
  const required = where.filter((condition) => condition.connector !== "OR");
  const alternatives = where.filter(
    (condition) => condition.connector === "OR"
  );
  if (alternatives.length === 0) {
    return [required];
  }
  return alternatives.map((alternative) => [...required, alternative]);
}

function relationName(model: AuthModel, joinedModel: string): string {
  if (model === "user" && joinedModel === "account") {
    return "accounts";
  }
  if (model === "user" && joinedModel === "session") {
    return "sessionsSessions";
  }
  if (model === "account" && joinedModel === "user") {
    return "user";
  }
  if (model === "session" && joinedModel === "user") {
    return "user";
  }
  if (model === "verification" && joinedModel === "user") {
    return "user";
  }
  throw new Error(`Unsupported Better Auth relation: ${model}.${joinedModel}`);
}

function includeJoin(
  collection: DynamicCollection,
  model: AuthModel,
  join: JoinConfig
): DynamicCollection {
  let query = collection;
  const entries = Object.entries(join);
  const accountJoin = entries.find(
    ([joinedModel]) => joinedModel === "account"
  );
  if (model === "session" && accountJoin) {
    query = query.include("user", (user) =>
      user.include("accounts", (accounts) => {
        const accountQuery = accounts;
        return accountJoin[1].limit
          ? accountQuery.limit(accountJoin[1].limit)
          : accountQuery;
      })
    );
  }
  for (const [joinedModel, config] of entries) {
    if (model === "session" && joinedModel === "account") {
      continue;
    }
    const relation = relationName(model, joinedModel);
    query = query.include(relation, (related) => {
      const limited =
        config.relation === "one-to-many" && config.limit
          ? related.limit(config.limit)
          : related;
      return limited;
    });
  }
  return query;
}

function normalizeJoinedRecord(
  record: AuthRecord,
  model: AuthModel,
  join: JoinConfig | undefined
): AuthRecord {
  if (model !== "session" || !join?.account) {
    return record;
  }
  const { user } = record;
  if (typeof user !== "object" || user === null) {
    return record;
  }
  const accounts = Reflect.get(user, "accounts");
  return { ...record, accounts };
}

async function readRows(
  context: AdapterContext,
  model: AuthModel,
  where: CleanedWhere[] | undefined,
  options: {
    join?: JoinConfig;
    limit?: number;
    offset?: number;
    select?: string[];
    sortBy?: { direction: "asc" | "desc"; field: string };
  } = {}
): Promise<AuthRecord[]> {
  const branches = whereBranches(where);
  const branchRows = await Promise.all(
    branches.map(async (branch) => {
      let query = modelCollection(context.orm, model);
      if (options.select) {
        query = query.select(...options.select);
      }
      if (options.join) {
        query = includeJoin(query, model, options.join);
      }
      if (branch.length > 0) {
        query = query.where((accessor) => whereExpression(accessor, branch));
      }
      if (options.sortBy) {
        const { direction, field } = options.sortBy;
        query = query.orderBy((accessor) => {
          const orderField = Reflect.get(accessor, field);
          if (
            typeof orderField !== "object" ||
            orderField === null ||
            !("asc" in orderField) ||
            typeof orderField.asc !== "function"
          ) {
            throw new Error(`Unknown Better Auth sort field: ${field}`);
          }
          return direction === "desc" ? orderField.desc() : orderField.asc();
        });
      }
      if (options.limit) {
        query = query.limit(options.limit);
      }
      const rows = await query.all();
      return rows.map((row) => normalizeJoinedRecord(row, model, options.join));
    })
  );
  const rows = branchRows.flat();
  const uniqueRows = [
    ...new Map(rows.map((row) => [String(row.id), row])).values(),
  ];
  const orderedRows = options.sortBy
    ? uniqueRows.toSorted((left, right) => {
        const leftValue = left[options.sortBy?.field ?? ""];
        const rightValue = right[options.sortBy?.field ?? ""];
        if (leftValue === rightValue) {
          return 0;
        }
        const comparison = (leftValue ?? 0) > (rightValue ?? 0) ? 1 : -1;
        return options.sortBy?.direction === "desc" ? -comparison : comparison;
      })
    : uniqueRows;
  const offset = options.offset ?? 0;
  return orderedRows.slice(
    offset,
    options.limit ? offset + options.limit : undefined
  );
}

async function matchingIds(
  context: AdapterContext,
  model: AuthModel,
  where: CleanedWhere[]
): Promise<string[]> {
  if (where.length === 0) {
    throw new Error("A predicate is required for this Better Auth operation");
  }
  const rows = await readRows(context, model, where, { select: ["id"] });
  return rows.map((row) => String(row.id));
}

function createCustomAdapter(context: AdapterContext): CustomAdapter {
  return {
    async count({
      model,
      where,
    }: {
      model: string;
      where?: CleanedWhere[];
    }): Promise<number> {
      const resolved = authModel(model);
      if (!where?.length) {
        const result = await modelCollection(context.orm, resolved).aggregate(
          (aggregate) => ({ count: aggregate.count() })
        );
        const { count } = result;
        return Number(count ?? 0);
      }
      const ids = await matchingIds(context, resolved, where);
      return ids.length;
    },
    async create<T extends Record<string, unknown>>({
      data,
      model,
      select,
    }: {
      data: T;
      model: string;
      select?: string[];
    }): Promise<T> {
      let collection = modelCollection(context.orm, authModel(model));
      if (select) {
        collection = collection.select(...select);
      }
      const result = await collection.create(toPrismaData(data) as AuthRecord);
      return fromPrismaData(result) as T;
    },
    async delete({
      model,
      where,
    }: {
      model: string;
      where: CleanedWhere[];
    }): Promise<void> {
      const resolved = authModel(model);
      if (!where.some((condition) => condition.field === "id")) {
        const ids = await matchingIds(context, resolved, where);
        if (ids.length > 0) {
          await modelCollection(context.orm, resolved)
            .where((accessor) => dynamicField(accessor, "id").in(ids))
            .deleteAndCount();
        }
        return;
      }
      const [row] = await readRows(context, resolved, where, { limit: 1 });
      const { id } = row ?? {};
      if (typeof id === "string") {
        await modelCollection(context.orm, resolved).where({ id }).delete();
      }
    },
    async deleteMany({
      model,
      where,
    }: {
      model: string;
      where: CleanedWhere[];
    }): Promise<number> {
      const resolved = authModel(model);
      const ids = await matchingIds(context, resolved, where);
      if (ids.length === 0) {
        return 0;
      }
      return await modelCollection(context.orm, resolved)
        .where((accessor) => dynamicField(accessor, "id").in(ids))
        .deleteAndCount();
    },
    async findMany<T>({
      join,
      limit,
      model,
      offset,
      select,
      sortBy,
      where,
    }: {
      join?: JoinConfig;
      limit: number;
      model: string;
      offset?: number;
      select?: string[];
      sortBy?: { direction: "asc" | "desc"; field: string };
      where?: CleanedWhere[];
    }): Promise<T[]> {
      const rows = await readRows(context, authModel(model), where, {
        join,
        limit: limit || 100,
        offset,
        select,
        sortBy,
      });
      return fromPrismaData(rows) as T[];
    },
    async findOne<T>({
      join,
      model,
      select,
      where,
    }: {
      join?: JoinConfig;
      model: string;
      select?: string[];
      where: CleanedWhere[];
    }): Promise<T | null> {
      const rows = await readRows(context, authModel(model), where, {
        join,
        limit: 1,
        select,
      });
      const [row] = rows;
      return row ? (fromPrismaData(row) as T) : null;
    },
    options: {
      provider: "postgresql",
    },
    async update<T>({
      model,
      update,
      where,
    }: {
      model: string;
      update: T;
      where: CleanedWhere[];
    }): Promise<T | null> {
      const resolved = authModel(model);
      const [row] = await readRows(context, resolved, where, { limit: 1 });
      const { id } = row ?? {};
      if (typeof id !== "string") {
        return null;
      }
      const result = await modelCollection(context.orm, resolved)
        .where({ id })
        .update(toPrismaData(update) as AuthRecord);
      return result ? (fromPrismaData(result) as T) : null;
    },
    async updateMany({
      model,
      update,
      where,
    }: {
      model: string;
      update: Record<string, unknown>;
      where: CleanedWhere[];
    }): Promise<number> {
      const resolved = authModel(model);
      const ids = await matchingIds(context, resolved, where);
      if (ids.length === 0) {
        return 0;
      }
      return await modelCollection(context.orm, resolved)
        .where((accessor) => dynamicField(accessor, "id").in(ids))
        .updateAndCount(toPrismaData(update) as AuthRecord);
    },
  };
}

export function prismaAdapter(client: PrismaClient = prisma) {
  let lazyOptions: BetterAuthOptions | undefined;
  const context: AdapterContext = {
    orm: client.orm,
    transaction: client.transaction.bind(client),
  };
  const config = {
    adapterId: "prisma",
    adapterName: "Prisma Adapter",
    supportsArrays: true,
    supportsUUIDs: true,
    transaction: <R>(callback: (adapter: DBTransactionAdapter) => Promise<R>) =>
      context.transaction(async (transaction) => {
        if (!lazyOptions) {
          throw new Error("Prisma 8 adapter options are not initialized");
        }
        const transactionContext: AdapterContext = {
          orm: transaction.orm,
          transaction: context.transaction,
        };
        const transactionAdapter = createAdapterFactory({
          adapter: () => createCustomAdapter(transactionContext),
          config: {
            adapterId: "prisma-8-transaction",
            adapterName: "Prisma 8 Transaction Adapter",
            supportsArrays: true,
            supportsUUIDs: true,
          },
        })(lazyOptions);
        return await callback(transactionAdapter);
      }),
  } as const;
  const adapter = createAdapterFactory({
    adapter: () => createCustomAdapter(context),
    config,
  });
  return (options: BetterAuthOptions): DBAdapter =>
    adapter((lazyOptions = options));
}
