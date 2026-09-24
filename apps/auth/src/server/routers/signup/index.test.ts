import { beforeEach, describe, expect, mock, test } from "bun:test";

const EMAIL = "test@example.com";
const EMAIL_LOWER = EMAIL;
const FAIL_KEY = `rate:signup:verifyfail:${EMAIL_LOWER}`;
const PENDING_EMAIL_KEY = `pending-signup:email:${EMAIL_LOWER}`;
const PENDING_KEY = "pending-signup:tok-1";
const IDENTIFIER = `email-verification-otp-${EMAIL_LOWER}`;

const FUTURE = new Date(Date.now() + 300_000);

const redisStore = new Map<string, string>();
const redisCalls: { args: unknown[]; op: string }[] = [];

const redisMock = {
  del: (...keys: string[]) => {
    redisCalls.push({ args: keys, op: "del" });
    let deleted = 0;
    for (const key of keys) {
      if (redisStore.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  },
  get: (key: string) => redisStore.get(key) ?? null,
  multi: () => {
    const ops: { args: unknown[]; op: string }[] = [];
    const chain = {
      exec: () =>
        ops.map(({ args, op }) => {
          if (op === "incr") {
            const key = args[0] as string;
            const next = Number(redisStore.get(key) ?? 0) + 1;
            redisStore.set(key, String(next));
            return [null, next];
          }
          if (op === "ttl") {
            return [null, 900];
          }
          return [null, 1];
        }),
      expire: (key: string, seconds: number) => {
        ops.push({ args: [key, seconds], op: "expire" });
        return chain;
      },
      incr: (key: string) => {
        ops.push({ args: [key], op: "incr" });
        return chain;
      },
      ttl: (key: string) => {
        ops.push({ args: [key], op: "ttl" });
        return chain;
      },
    };
    return chain;
  },
  set: (key: string, value: string) => {
    redisStore.set(key, value);
    return "OK";
  },
};

const prismaCalls: { args: unknown; model: string; op: string }[] = [];
interface VerificationRecord {
  expiresAt: Date;
  id: string;
  identifier: string;
  value: string;
}
type VerificationField = "expiresAt" | "identifier";
type VerificationExpression =
  | { expressions: VerificationExpression[]; operator: "and" }
  | {
      field: VerificationField;
      operator: "eq" | "gte" | "ilike" | "lt";
      value: Date | string;
    };
let liveCodes: VerificationRecord[] = [];
let verificationWhere: VerificationExpression | null = null;
let existingSignupUser: {
  email: string | null;
  id: string;
  passwordHash: string | null;
  username: string;
} | null = null;

function matchesLike(value: string, pattern: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index += 1;
      expression +=
        pattern[index]?.replaceAll(/[\\^$.|?*+()[\]{}]/g, "\\$&") ?? "";
    } else if (character === "%") {
      expression += ".*";
    } else if (character === "_") {
      expression += ".";
    } else {
      expression += character.replaceAll(/[\\^$.|?*+()[\]{}]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "i").test(value);
}

function matchesVerificationExpression(
  record: VerificationRecord,
  expression: VerificationExpression | null
): boolean {
  if (!expression) {
    return true;
  }
  if (expression.operator === "and") {
    return expression.expressions.every((entry) =>
      matchesVerificationExpression(record, entry)
    );
  }
  if (expression.field === "expiresAt") {
    const actual = record.expiresAt.getTime();
    const expected =
      expression.value instanceof Date ? expression.value.getTime() : 0;
    if (expression.operator === "gte") {
      return actual >= expected;
    }
    if (expression.operator === "lt") {
      return actual < expected;
    }
  }
  if (expression.operator === "eq") {
    return record.identifier === expression.value;
  }
  return matchesLike(record.identifier, String(expression.value));
}

function expressionHasField(
  expression: VerificationExpression | null,
  field: VerificationField
): boolean {
  if (!expression) {
    return false;
  }
  if (expression.operator === "and") {
    return expression.expressions.some((entry) =>
      expressionHasField(entry, field)
    );
  }
  return expression.field === field;
}

const mockAccountCreate = (data: Record<string, unknown>) => {
  prismaCalls.push({
    args: { data },
    model: "account",
    op: "create",
  });
  return Promise.resolve({});
};
const mockUserCreate = () => {
  prismaCalls.push({
    args: {},
    model: "user",
    op: "create",
  });
  return Promise.resolve({ id: "user-1" });
};
const mockUserFirst = () => Promise.resolve(existingSignupUser);
const mockVerificationDelete = () => {
  prismaCalls.push({
    args: verificationWhere,
    model: "verification",
    op: expressionHasField(verificationWhere, "expiresAt")
      ? "cleanup"
      : "consume",
  });
  const matchedIds = new Set(
    liveCodes
      .filter((record) =>
        matchesVerificationExpression(record, verificationWhere)
      )
      .map((record) => record.id)
  );
  liveCodes = liveCodes.filter((record) => !matchedIds.has(record.id));
  return Promise.resolve(matchedIds.size);
};
const mockVerificationAll = () =>
  Promise.resolve(
    liveCodes.filter((record) =>
      matchesVerificationExpression(record, verificationWhere)
    )
  );
const verificationQuery = {
  all: mockVerificationAll,
  deleteAndCount: mockVerificationDelete,
  where: (predicate: (accessor: object) => unknown) => {
    const accessor = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (typeof property !== "string") {
            return;
          }
          const field = property as VerificationField;
          return {
            eq: (value: Date | string) => ({ field, operator: "eq", value }),
            gte: (value: Date | string) => ({ field, operator: "gte", value }),
            ilike: (value: string) => ({ field, operator: "ilike", value }),
            lt: (value: Date | string) => ({ field, operator: "lt", value }),
          };
        },
      }
    );
    verificationWhere = predicate(accessor) as VerificationExpression;
    return verificationQuery;
  },
};
const userQuery = {
  create: mockUserCreate,
  first: mockUserFirst,
  where: () => userQuery,
};
const prismaMock = {
  orm: {
    public: {
      Accounts: { create: mockAccountCreate },
      Users: { select: () => userQuery },
      Verification: {
        select: () => verificationQuery,
        where: verificationQuery.where,
      },
    },
  },
};

// The signup router only uses prisma/redis/isReservedUsername from @asm/db.
mock.module("@asm/db", () => ({
  and: (...expressions: VerificationExpression[]) => ({
    expressions,
    operator: "and",
  }),
  fromPrismaDateTime: (value: Date) => value,
  isReservedUsername: () => false,
  prisma: prismaMock,
  redis: redisMock,
  toPrismaDateTime: (value: Date) => value,
}));

mock.module("@/auth/config", () => ({
  auth: {
    api: {
      createVerificationOTP: () => "654321",
    },
  },
}));

mock.module("@/email/service", () => ({
  sendPasswordResetEmail: () => ({ success: true }),
  sendVerificationEmail: () => ({ success: true }),
  sendVerificationOTP: () => ({ success: true }),
  validateEmailServiceConfig: () => ({ valid: true }),
}));

mock.module("@asm/auth/core", () => ({
  PasswordSafetyError: class PasswordSafetyError extends Error {
    constructor() {
      super();
      this.name = "PasswordSafetyError";
    }
  },
  assertPasswordNotPwned: () => Promise.resolve(),
  getSessionFromRequest: () => ({ session: null, user: null }),
  hashPasswordWithScrypt: () => "scrypt-hash",
}));

mock.module("@asm/auth", () => ({
  validateEmailAdvanced: () => Promise.resolve({ isValid: true }),
}));

// Other test files delete BETTER_AUTH_SECRET from process.env mid-suite; the
// router's real config validates env at import, so restore the secret and load
// the router dynamically (after the mocks above are registered).
process.env.BETTER_AUTH_SECRET ??= "test-secret-auth-local-32-chars-minimum";
const { signupRouter } = await import("./index");

const pendingPayload = {
  displayName: "Tester",
  email: EMAIL,
  password: "plaintext-password",
  passwordHash: "scrypt-hash",
  username: "tester",
};

function baseCtx() {
  return {
    req: new Request("http://localhost:3001/api/trpc/pendingSignupVerify", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    }),
    resHeaders: new Headers(),
    session: null,
    user: null,
  };
}

function createCaller() {
  type RouterContext = Parameters<typeof signupRouter.createCaller>[0];
  return signupRouter.createCaller(baseCtx() as unknown as RouterContext);
}

function consumeCalls(): number {
  return prismaCalls.filter((call) => call.op === "consume").length;
}

function cleanupCalls(): number {
  return prismaCalls.filter((call) => call.op === "cleanup").length;
}

describe("pendingSignupVerify OTP security contract", () => {
  beforeEach(() => {
    redisStore.clear();
    redisCalls.length = 0;
    prismaCalls.length = 0;
    existingSignupUser = null;
    liveCodes = [];
  });

  test("a wrong code increments the failure counter once and does not consume below the threshold", async () => {
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];

    const caller = createCaller();
    const result = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "000000",
      otpVerified: true,
    });

    expect(result).toEqual({ error: "invalid-otp", success: false });
    expect(redisStore.get(FAIL_KEY)).toBe("1");
    expect(consumeCalls()).toBe(0);
  });

  test("guesses without a live code do not touch the failure counter (no freeze attack)", async () => {
    const caller = createCaller();
    const result = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "000000",
      otpVerified: true,
    });

    expect(result).toEqual({ error: "invalid-otp", success: false });
    expect(redisStore.has(FAIL_KEY)).toBe(false);
  });

  test("does not read an OTP from a lookalike address when the requested email contains an underscore", async () => {
    const email = "first_last@example.com";
    const lookalikeEmail = "firstXlast@example.com";
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "lookalike-code",
        identifier: `email-verification-otp-${lookalikeEmail}`,
        value: "123456:0",
      },
    ];
    redisStore.set(`pending-signup:email:${email}`, "tok-1");
    redisStore.set(
      "pending-signup:tok-1",
      JSON.stringify({ ...pendingPayload, email })
    );

    const result = await createCaller().pendingSignupVerify({
      email,
      otp: "123456",
      otpVerified: true,
    });

    expect(result).toEqual({ error: "invalid-otp", success: false });
    expect(
      prismaCalls.some((call) => call.model === "user" && call.op === "create")
    ).toBe(false);
  });

  test("consuming an underscored email does not delete a lookalike address's code", async () => {
    const email = "first_last@example.com";
    const lookalikeEmail = "firstXlast@example.com";
    const failKey = `rate:signup:verifyfail:${email}`;
    redisStore.set(failKey, "4");
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "requested-code",
        identifier: `email-verification-otp-${email}`,
        value: "123456:0",
      },
      {
        expiresAt: FUTURE,
        id: "lookalike-code",
        identifier: `email-verification-otp-${lookalikeEmail}`,
        value: "654321:0",
      },
    ];

    const result = await createCaller().pendingSignupVerify({
      email,
      otp: "000000",
      otpVerified: true,
    });

    expect(result).toEqual({ error: "invalid-otp", success: false });
    expect(liveCodes.map((record) => record.id)).toEqual(["lookalike-code"]);
  });

  test("reaching the failure threshold consumes the verification code in the same request", async () => {
    redisStore.set(FAIL_KEY, "4");
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];

    const caller = createCaller();
    const result = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "000000",
      otpVerified: true,
    });

    expect(result).toEqual({ error: "invalid-otp", success: false });
    expect(redisStore.get(FAIL_KEY)).toBe("5");
    expect(consumeCalls()).toBe(2);
  });

  test("a locked budget rejects without a database lookup and consumes the code", async () => {
    redisStore.set(FAIL_KEY, "5");
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];

    const caller = createCaller();
    const result = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "123456",
      otpVerified: true,
    });

    expect(result).toEqual({ error: "invalid-otp", success: false });
    expect(consumeCalls()).toBe(2);
    expect(prismaCalls.filter((call) => call.op === "findMany").length).toBe(0);
  });

  test("a correct code clears the failure counter and completes verification", async () => {
    redisStore.set(FAIL_KEY, "2");
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];
    redisStore.set(PENDING_EMAIL_KEY, "tok-1");
    redisStore.set(PENDING_KEY, JSON.stringify(pendingPayload));

    const caller = createCaller();
    const result = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "123456",
      otpVerified: true,
    });

    expect(result).toMatchObject({ email: EMAIL, success: true });
    expect(redisStore.has(FAIL_KEY)).toBe(false);
    expect(redisStore.has(PENDING_KEY)).toBe(false);
    expect(redisCalls.some((call) => call.op === "del")).toBe(true);
  });

  test("a correct code still works after one wrong guess (counter below threshold)", async () => {
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];
    redisStore.set(PENDING_EMAIL_KEY, "tok-1");
    redisStore.set(PENDING_KEY, JSON.stringify(pendingPayload));

    const caller = createCaller();

    const wrong = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "000000",
      otpVerified: true,
    });
    expect(wrong).toEqual({ error: "invalid-otp", success: false });

    const right = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "123456",
      otpVerified: true,
    });
    expect(right).toMatchObject({ success: true });
    expect(redisStore.has(FAIL_KEY)).toBe(false);
  });

  test("the expired-record cleanup still runs before a lookup", async () => {
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];

    const caller = createCaller();
    await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "000000",
      otpVerified: true,
    });

    // Both the flow-level expired-record cleanup and the in-verify cleanup run.
    expect(cleanupCalls()).toBeGreaterThanOrEqual(1);
    expect(consumeCalls()).toBe(0);
  });

  test("successful verification writes exactly one credential account in the better-auth 1.7 shape", async () => {
    liveCodes = [
      {
        expiresAt: FUTURE,
        id: "v1",
        identifier: IDENTIFIER,
        value: "123456:0",
      },
    ];
    redisStore.set(PENDING_EMAIL_KEY, "tok-1");
    redisStore.set(PENDING_KEY, JSON.stringify(pendingPayload));

    const caller = createCaller();
    const result = await caller.pendingSignupVerify({
      email: EMAIL,
      otp: "123456",
      otpVerified: true,
    });
    expect(result).toMatchObject({ success: true });

    // The credential contract better-auth 1.7 enforces at sign-in:
    // providerId "credential", issuer "local:credential", and accountId
    // equal to the user id. Any other shape is invisible to authentication
    // (this regression produced 401 "User not found" after signup).
    const accountCreates = prismaCalls.filter(
      (call) => call.model === "account" && call.op === "create"
    );
    expect(accountCreates).toHaveLength(1);
    const [firstCreate] = accountCreates;
    if (!firstCreate) {
      throw new Error("expected one account create call");
    }
    const { data } = firstCreate.args as {
      data: Record<string, unknown>;
    };
    expect(data.providerId).toBe("credential");
    expect(data.issuer).toBe("local:credential");
    expect(data.accountId).toBe("user-1");
    expect(data.userId).toBe("user-1");
    expect(data.password).toBe("scrypt-hash");

    // The raw password rides the internal tRPC response so the web layer
    // can auto-sign-in after verification.
    expect(result).toMatchObject({
      email: EMAIL,
      password: "plaintext-password",
    });
  });
});

describe("pendingSignupStart existing account contract", () => {
  beforeEach(() => {
    existingSignupUser = null;
    redisStore.clear();
  });

  test("directs an existing password account to login", async () => {
    existingSignupUser = {
      email: EMAIL,
      id: "password-user",
      passwordHash: "scrypt-hash",
      username: "existing-password-user",
    };

    const result = await createCaller().pendingSignupStart({
      displayName: "New Name",
      email: EMAIL,
      password: "SecurePassword#1",
      username: "new-name",
    });

    expect(result).toEqual({
      error: "user-exists",
      message:
        "An account with this email or username already exists. Try logging in or use Forgot Password.",
      success: false,
    });
  });

  test("directs an OAuth-only account with the same email to login", async () => {
    existingSignupUser = {
      email: EMAIL,
      id: "oauth-user",
      passwordHash: null,
      username: "existing-oauth-user",
    };

    const result = await createCaller().pendingSignupStart({
      displayName: "New Name",
      email: EMAIL,
      password: "SecurePassword#1",
      username: "new-name",
    });

    expect(result).toEqual({
      error: "user-exists",
      message:
        "An account with this email or username already exists. Try logging in or use Forgot Password.",
      success: false,
    });
  });
});
