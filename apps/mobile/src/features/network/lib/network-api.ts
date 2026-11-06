import {
  networkPreferencesSchema,
  networkTopicPageSchema,
} from "@asm/protocols/discovery";
import { z } from "zod";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { withAuthHeaders } from "@/lib/network/auth-headers";

const terms = z.record(z.string(), z.array(z.string()));
export const networkSettingsSchema = z.object({
  catalog: z.array(z.string()),
  persona: z.object({
    avoidedTopics: z.array(z.string()),
    learnedInterests: z.array(z.string()),
    relatedInterests: z.array(z.string()),
    signalCount: z.number(),
  }),
  preferences: networkPreferencesSchema,
  revision: z.number().int().nonnegative(),
  topicScope: z
    .object({
      aliases: terms.optional(),
      avoided: terms,
      interests: terms,
      qualifiers: terms.optional(),
      related: terms.optional(),
      version: z.string(),
    })
    .optional(),
});

export class NetworkRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "NetworkRequestError";
    this.status = status;
  }
}

export async function networkRequest(
  path: string,
  init: RequestInit = {},
  cookie?: string
): Promise<unknown> {
  const credential = cookie ?? (await authClient.getCookie());
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...withAuthHeaders(
        {
          "x-asm-client": "mobile",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        credential
      ),
      ...Object.fromEntries(new Headers(init.headers)),
    },
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = z.object({ error: z.string() }).safeParse(body);
    throw new NetworkRequestError(
      problem.success
        ? problem.data.error
        : `Request failed (${response.status})`,
      response.status
    );
  }
  return body;
}

export async function readNetworkTopics(
  query: string,
  parent?: string,
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  } else if (parent) {
    params.set("parent", parent);
  }
  return networkTopicPageSchema.parse(
    await networkRequest(`/api/network/topics?${params}`, { signal })
  );
}
