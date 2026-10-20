import {
  redis,
  getClientIpFromHeaders,
  getTrustedIngressIp,
  hashViewerId,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { protocolGuest } from "@/lib/protocols/guest";

const claimBudget = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local windows = {60000, 10000}
local limits = {60, 24}
local wait = 0
for index = 1, 2 do
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now - windows[index])
  if redis.call('ZCARD', KEYS[index]) >= limits[index] then
    local oldest = redis.call('ZRANGE', KEYS[index], 0, 0, 'WITHSCORES')
    wait = math.max(wait, tonumber(oldest[2]) + windows[index] - now)
  end
end
if wait > 0 then return math.ceil(wait / 1000) end
for index = 1, 2 do
  redis.call('ZADD', KEYS[index], now, ARGV[1])
  redis.call('PEXPIRE', KEYS[index], windows[index] + 1000)
end
return 0
`;

export async function guestSearchBudget(request: Request) {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  const session = await getSessionFromApi();
  if (session?.user.id) {
    return { headers, response: null };
  }
  const guest = protocolGuest(request, Date.now(), {
    cookieName: "asm_search_guest",
    path: "/api",
    secret:
      process.env.PROTOCOLS_GUEST_SECRET ??
      process.env.PROTOCOLS_INTERNAL_TOKEN ??
      process.env.BETTER_AUTH_SECRET,
  });
  if (guest.cookie) {
    headers.append("set-cookie", guest.cookie);
  }
  const ip =
    process.env.NODE_ENV === "production"
      ? getTrustedIngressIp(request.headers)
      : getClientIpFromHeaders(request.headers);
  const identifier =
    guest.identity === "unconfigured"
      ? `ingress:${hashViewerId(ip)}`
      : guest.identity;
  let retryAfter: number;
  try {
    retryAfter = Number(
      await redis.eval(
        claimBudget,
        2,
        `ratelimit:search:{${identifier}}:minute`,
        `ratelimit:search:{${identifier}}:burst`,
        crypto.randomUUID()
      )
    );
    if (!Number.isFinite(retryAfter) || retryAfter < 0) {
      throw new Error("Invalid search budget response");
    }
  } catch {
    headers.set("retry-after", "1");
    return {
      headers,
      response: Response.json(
        { error: "Search is temporarily busy. Try again shortly." },
        { headers, status: 503 }
      ),
    };
  }
  if (retryAfter > 0) {
    headers.set("retry-after", String(retryAfter));
    return {
      headers,
      response: Response.json(
        {
          error: "Search limit reached. Please try again shortly.",
          retryAfter,
        },
        { headers, status: 429 }
      ),
    };
  }
  return { headers, response: null };
}
