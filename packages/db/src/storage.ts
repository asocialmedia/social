import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// Server-only shared object storage client used by both the web app and the
// background worker. The worker needs to delete media objects when posts are
// deleted or abandoned uploads expire, so the client cannot live in apps/web.
// Env vars are read directly (with the same defaults the web app uses) so this
// module works in any runtime that has the ASMOB_* variables configured.

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// The object-storage endpoint may be configured without a protocol; the AWS
// SDK fails with ERR_INVALID_URL unless the endpoint is an absolute URL, so
// normalize a bare hostname to https.
function normalizeEndpoint(endpoint: string): string {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
}

export const ASMOB_BUCKET = env("ASMOB_BUCKET_NAME", "uploads");

const asmobEndpoint = normalizeEndpoint(
  env("ASMOB_ENDPOINT", "http://localhost:9090")
);

export const asmobClient = new S3Client({
  credentials: {
    accessKeyId: env("ASMOB_ROOT_USER", "asmob-admin"),
    secretAccessKey: env("ASMOB_ROOT_PASSWORD", "asmob-admin"),
  },
  endpoint: asmobEndpoint,
  forcePathStyle: true,
  maxAttempts: 3,
  region: "ap-south-1",
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    socketTimeout: 5000,
  }),
});

export async function deleteObject(key: string): Promise<void> {
  if (!key) {
    return;
  }
  await asmobClient.send(
    new DeleteObjectCommand({
      Bucket: ASMOB_BUCKET,
      Key: key,
    })
  );
}
