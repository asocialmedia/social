import { redis } from "@asm/db";

export const GLOBAL_SEARCH_SESSION_TTL_SECONDS = 15 * 60;
export const MAX_GLOBAL_SEARCH_SESSIONS = 4;
const SESSION_KEY_PREFIX = "messages:global-search:v2:";

export const SAVE_GLOBAL_SEARCH_MANIFEST = `
local fields = redis.call('HKEYS', KEYS[1])
for _, field in ipairs(fields) do
  local deadline = tonumber(string.match(field, '^(%d+):'))
  if not deadline or deadline <= tonumber(ARGV[3]) then
    redis.call('HDEL', KEYS[1], field)
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
fields = redis.call('HKEYS', KEYS[1])
table.sort(fields)
local remaining = #fields - tonumber(ARGV[5])
for _, field in ipairs(fields) do
  if remaining > 0 and field ~= ARGV[1] then
    redis.call('HDEL', KEYS[1], field)
    remaining = remaining - 1
  end
end
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`;

function sessionKey(userId: string): string {
  return `${SESSION_KEY_PREFIX}${userId}`;
}

export async function saveGlobalSearchManifest(input: {
  encoded: string;
  expiresAt: number;
  sessionId: string;
  userId: string;
}): Promise<void> {
  const saved = await redis.eval(
    SAVE_GLOBAL_SEARCH_MANIFEST,
    1,
    sessionKey(input.userId),
    `${input.expiresAt}:${input.sessionId}`,
    input.encoded,
    Date.now(),
    GLOBAL_SEARCH_SESSION_TTL_SECONDS,
    MAX_GLOBAL_SEARCH_SESSIONS
  );
  if (saved !== 1) {
    throw new Error("Search session could not be created");
  }
}

export function readGlobalSearchManifest(input: {
  expiresAt: number;
  sessionId: string;
  userId: string;
}): Promise<string | null> {
  return redis.hget(
    sessionKey(input.userId),
    `${input.expiresAt}:${input.sessionId}`
  );
}
