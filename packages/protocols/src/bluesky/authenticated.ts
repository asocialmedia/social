import { Client, asAtUriString, buildAgent } from "@atproto/lex";
import { like, post, repost } from "@bsky/sdk";

export interface BlueskyAuthSession {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  handle: string;
  service?: string;
}

export interface BlueskyCredentials {
  identifier: string;
  password: string;
  service?: string;
}

export interface BlueskyRecordResult {
  cid: string;
  uri: string;
}

const DEFAULT_BSKY_SERVICE = "https://bsky.social";

export async function resolveBlueskyHandle(
  handle: string,
  service = DEFAULT_BSKY_SERVICE
): Promise<{ did: string }> {
  const cleanHandle = handle.replace(/^@/, "").trim().toLowerCase();
  const url = new URL("/xrpc/com.atproto.identity.resolveHandle", service);
  url.searchParams.set("handle", cleanHandle);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Could not resolve Bluesky handle "${cleanHandle}": ${response.status}`
    );
  }

  const data = (await response.json()) as { did?: string };
  if (!data.did) {
    throw new Error(`No DID returned for handle "${cleanHandle}"`);
  }

  return { did: data.did };
}

export async function createBlueskySession(
  credentials: BlueskyCredentials
): Promise<BlueskyAuthSession> {
  const service = credentials.service ?? DEFAULT_BSKY_SERVICE;
  const cleanIdentifier = credentials.identifier.replace(/^@/, "").trim();

  const response = await fetch(
    new URL("/xrpc/com.atproto.server.createSession", service),
    {
      body: JSON.stringify({
        identifier: cleanIdentifier,
        password: credentials.password,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      errorData.message || "Invalid Bluesky identifier or App Password"
    );
  }

  const data = (await response.json()) as {
    accessJwt: string;
    refreshJwt?: string;
    did: string;
    handle: string;
  };

  return {
    accessJwt: data.accessJwt,
    did: data.did,
    handle: data.handle,
    refreshJwt: data.refreshJwt,
    service,
  };
}

export function createAuthenticatedClient(session: {
  accessJwt: string;
  did: string;
  service?: string;
}): Client {
  const agent = buildAgent({
    did: session.did as `did:${string}:${string}`,
    headers: { authorization: `Bearer ${session.accessJwt}` },
    service: session.service ?? DEFAULT_BSKY_SERVICE,
  });
  return new Client(agent);
}

export async function publishBlueskyReply(
  session: { accessJwt: string; did: string; service?: string },
  reply: {
    parentCid: string;
    parentUri: string;
    rootCid: string;
    rootUri: string;
    text: string;
  }
): Promise<BlueskyRecordResult> {
  const client = createAuthenticatedClient(session);
  const result = await post(
    client,
    {
      reply: {
        parent: { cid: reply.parentCid, uri: asAtUriString(reply.parentUri) },
        root: { cid: reply.rootCid, uri: asAtUriString(reply.rootUri) },
      },
      text: reply.text,
    },
    {}
  );
  return { cid: result.cid, uri: result.uri };
}

export async function publishBlueskyLike(
  session: { accessJwt: string; did: string; service?: string },
  subject: { cid: string; uri: string }
): Promise<BlueskyRecordResult> {
  const client = createAuthenticatedClient(session);
  const result = await like(
    client,
    { cid: subject.cid, uri: asAtUriString(subject.uri) },
    {}
  );
  return { cid: result.cid, uri: result.uri };
}

export async function publishBlueskyRepost(
  session: { accessJwt: string; did: string; service?: string },
  subject: { cid: string; uri: string }
): Promise<BlueskyRecordResult> {
  const client = createAuthenticatedClient(session);
  const result = await repost(
    client,
    { cid: subject.cid, uri: asAtUriString(subject.uri) },
    {}
  );
  return { cid: result.cid, uri: result.uri };
}
