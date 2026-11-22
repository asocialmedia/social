import { consumeRateLimit } from "@asm/db";
import { feedMixReportSchema, readJsonBounded } from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { reportFeedMix } from "@/lib/recommendations/feed-authority";
import { isTrustedMutationOrigin } from "@/lib/security/request-origin";

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return new Response(null, { status: 403 });
  }
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return new Response(null, { status: 401 });
  }
  const limit = await consumeRateLimit({
    bucket: "feed-delivery-metrics",
    identifier: session.user.id,
    limit: 12,
    windowSeconds: 60,
  }).catch(() => null);
  if (!limit?.allowed) {
    return new Response(null, { status: limit ? 429 : 503 });
  }
  const value = await readJsonBounded(
    request,
    1024,
    AbortSignal.timeout(1000)
  ).catch(() => null);
  const report = feedMixReportSchema.safeParse(value);
  if (!report.success) {
    return new Response(null, { status: 400 });
  }
  reportFeedMix(report.data);
  return new Response(null, { status: 204 });
}
