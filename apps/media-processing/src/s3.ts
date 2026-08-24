// Object storage access for the worker, built on Bun's native S3 client
// (zero npm dependencies; the web app keeps its own aws-sdk setup).

import { keys, workerEnv } from "./env";

let s3: Bun.S3Client | null = null;

export function getS3(): Bun.S3Client {
  if (!s3) {
    s3 = new Bun.S3Client({
      accessKeyId: keys.ASMOB_ROOT_USER,
      bucket: workerEnv.ASMOB_BUCKET,
      endpoint: keys.ASMOB_ENDPOINT,
      region: keys.ASMOB_REGION,
      secretAccessKey: keys.ASMOB_ROOT_PASSWORD,
    });
  }
  return s3;
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getS3().file(key).stat();
    return true;
  } catch {
    return false;
  }
}
