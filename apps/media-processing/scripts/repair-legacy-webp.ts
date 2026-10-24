// Run inside the media worker environment with explicit --media-id= values.
// The default is read-only; --apply publishes new objects and conditionally updates references.
// oxlint-disable no-await-in-loop -- explicit repairs finish and verify before the next asset starts.
import {
  and,
  closePrisma,
  closeQueueConnections,
  enqueueMediaAnalyze,
  enqueueMediaProcess,
  prisma,
  redis,
} from "@asm/db";

import { getS3 } from "../src/s3";
import { prepareLegacyWebpRepair } from "../src/transcode/legacy-webp";

const ids = [
  ...new Set(
    Bun.argv
      .filter((arg) => arg.startsWith("--media-id="))
      .map((arg) => arg.slice(11))
  ),
];
const apply = Bun.argv.includes("--apply");
if (
  !ids.length ||
  ids.length > 20 ||
  ids.some((id) => !/^[a-z\d_-]{1,100}$/i.test(id))
) {
  throw new Error("Provide 1–20 explicit --media-id= values");
}
try {
  for (const id of ids) {
    const row = await prisma.orm.public.PostMedia.select(
      "id",
      "key",
      "publishedKey",
      "status",
      "_type"
    )
      .where({ id })
      .first();
    if (!row || row.status !== "READY" || row._type !== "IMAGE") {
      throw new Error(`Media ${id} is not a READY image`);
    }
    const sourceKey = row.publishedKey ?? row.key;
    const source = getS3().file(sourceKey);
    const stat = await source.stat();
    if (stat.size > 16 * 1024 * 1024) {
      throw new Error(`Media ${id} exceeds the repair size bound`);
    }
    const repair = await prepareLegacyWebpRepair(
      Buffer.from(await source.arrayBuffer()),
      id
    );
    if (!repair) {
      console.log(JSON.stringify({ id, status: "not-applicable" }));
      continue;
    }
    if (!apply) {
      console.log(
        JSON.stringify({
          bytes: repair.bytes.length,
          id,
          status: "repair-validated",
        })
      );
      continue;
    }
    // Keep the damaged object intact; a content-addressed replacement is safe to retry.
    await getS3().write(repair.key, repair.bytes, { type: "image/webp" });
    const verified = await getS3().file(repair.key).arrayBuffer();
    if (!repair.bytes.equals(Buffer.from(verified))) {
      throw new Error(`Storage verification failed for ${id}`);
    }
    const updated = await prisma.orm.public.PostMedia.where((media) =>
      and(
        media.id.eq(id),
        media.status.eq("READY"),
        media._type.eq("IMAGE"),
        media.key.eq(row.key),
        row.publishedKey === null
          ? media.publishedKey.isNull()
          : media.publishedKey.eq(row.publishedKey)
      )
    ).updateAndCount({ key: repair.key, publishedKey: repair.key });
    if (!updated) {
      throw new Error(
        `Storage references changed during repair of ${id}; original references preserved`
      );
    }
    await enqueueMediaProcess(id, {
      jobIdSuffix: `webp-repair-${repair.hash.slice(0, 16)}`,
    });
    await enqueueMediaAnalyze(id, { semanticRefresh: true });
    console.log(
      JSON.stringify({ id, originalPreserved: true, status: "repaired" })
    );
  }
} finally {
  await closeQueueConnections();
  await closePrisma();
  redis.disconnect();
}
