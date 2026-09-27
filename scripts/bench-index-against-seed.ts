#!/usr/bin/env bun

// Headless exercise of the real search-index stack against the seeded 200k-row DM.
//
// Why this exists instead of "open the app and click": the browser path is slow to
// observe at this size (the backfill deliberately yields after 25 pages of 500, so
// 200,504 messages is ~401 pages and cannot finish in one pass), and the parts most
// likely to be wrong are pure: the key chain, the text extractor, row interning at
// 200k, posting-list intersection, and the dictionary order that defines the posting
// ids. All of those run here with no browser, using the SAME modules the app imports
// -- no reimplementation.
//
// What it proves, and what it does not:
//
//   Proves  the seeded ciphertext decrypts through the real derivation; the index
//           round-trips a genuine 200k-row corpus; AND queries return the exact
//           number of messages that really contain the word.
//   Does NOT cover the IndexedDB backend, the quota/eviction path, or the UI. Those
//           need a browser; see the manual checklist this prints at the end.
//
// It also ASSERTS rather than only reports: the per-query budget comes from
// `search-slo.ts`, so a regression that doubles the keystroke cost fails the run
// instead of producing a number nobody diffs. The browser budgets in the same file
// are deliberately NOT checked here -- `fake-indexeddb` and this in-memory path
// both lack the write lock and the structured-clone cost that dominate in a real
// browser, and asserting them against either would be asserting a fiction.
//

// Correctness is self-validating: the ground truth for each probe is counted while
// indexing, straight from the decrypted text, and the index's own answer is compared
// against it. A bug cannot hide by agreeing with a hardcoded expectation.
//
// Usage:
//   DATABASE_URL=... bun scripts/bench-index-against-seed.ts [options]
//
// Options:
//   --conversation=ID   Conversation to exercise (required)
//   --batch-size=N      Rows decrypted per batch (default: 5000)
//   --sample=N          Rows randomly sampled for the decrypt check (default: 4000)
//   --skip-decrypt-check  Index decrypted text only, skip the random re-decrypt
//   --queries=CSV       Override the probe words

import { prisma } from "@asm/db";

import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  importRatchetBaseKey,
  publicKeyBase64ToJwk,
  unwrapRootKey,
} from "../apps/web/src/lib/messages/crypto";
import { createMemorySearchIndexStore } from "../apps/web/src/lib/messages/memory-search-index";
import { extractSearchableText } from "../apps/web/src/lib/messages/message-search";
import {
  buildSearchIndexEntry,
  intersectPostingLists,
  selectNewestFirstWindow,
} from "../apps/web/src/lib/messages/search-index-format";
import type { SearchIndexEntry } from "../apps/web/src/lib/messages/search-index-format";
import { REFERENCE_QUERY_SLO_MS } from "../apps/web/src/lib/messages/search-slo";

function flag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberFlag(argv: string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function heapMb(): string {
  return mb(process.memoryUsage().heapUsed);
}

const PROBES = [
  // Rare, planted at a known low rate: catches a posting list that silently loses
  // or gains rows, which a common word would hide inside the noise.
  "zarquon",
  "veldrith",
  "obsidiancascade",
  // High frequency: these make the posting lists long, which is what the
  // intersection, the rarest-first ordering and the result cap actually exercise.
  "backfill",
  "p99",
  "keystore",
  // Absent from the corpus. The AND semantics require zero, and must not fall back
  // to the other token.
  "nonexistentword",
];

async function deriveRootKey(
  conversationId: string,
  ownerUserId: string,
  peerUserId: string
): Promise<Uint8Array> {
  const [owner, peer, wrap] = await Promise.all([
    prisma.messageIdentity.findUnique({ where: { userId: ownerUserId } }),
    prisma.messageIdentity.findUnique({ where: { userId: peerUserId } }),
    prisma.messageConversationKey.findFirst({
      orderBy: { version: "desc" },
      where: { conversationId, ownerUserId },
    }),
  ]);
  if (!owner?.masterKeyHash || !peer || !wrap) {
    throw new Error("missing identity or conversation key");
  }
  const salt = Uint8Array.from(atob(owner.salt), (c) => c.codePointAt(0) ?? 0);
  const masterKey = await deriveMasterKey(
    owner.masterKeyHash,
    salt,
    owner.kdfIterations
  );
  const [iv, ciphertext] = owner.encryptedPrivateKey.split(".");
  if (!iv || !ciphertext) {
    throw new Error("unreadable encryptedPrivateKey");
  }
  const privateKey = await importPrivateKeyJwk(
    JSON.parse(await decryptWithMasterKey(masterKey, { ciphertext, iv }))
  );
  return unwrapRootKey(
    privateKey,
    await importPublicKeyJwk(publicKeyBase64ToJwk(peer.publicKey)),
    conversationId,
    { ciphertext: wrap.encryptedKey, iv: wrap.iv }
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const conversationId = flag(argv, "conversation");
  if (!conversationId) {
    throw new Error("--conversation=ID is required");
  }
  const batchSize = numberFlag(argv, "batch-size", 5000);
  const sampleSize = numberFlag(argv, "sample", 4000);
  const skipDecryptCheck = argv.includes("--skip-decrypt-check");
  const probes = (flag(argv, "queries")?.split(",") ?? PROBES).map((word) =>
    word.trim()
  );

  const members = await prisma.messageConversationMember.findMany({
    select: { userId: true },
    where: { conversationId },
  });
  const [senderA, senderB] = members.map((m) => m.userId).toSorted();
  if (!senderA || !senderB) {
    throw new Error("expected two members");
  }

  const total = await prisma.message.count({ where: { conversationId } });
  console.log(`conversation ${conversationId}`);
  console.log(`  members    ${senderA}, ${senderB}`);
  console.log(`  messages   ${total}`);
  console.log(`  heap       ${heapMb()} at start`);

  // ---- 1. key chain --------------------------------------------------------
  const rootKey = await deriveRootKey(conversationId, senderA, senderB);
  console.log(
    "  root key   derived from the stored identity row and unwrapped"
  );

  // A raw sample decrypt, independent of the indexing pass below, so a key that
  // only works for some rows is caught before we trust the index.
  if (!skipDecryptCheck) {
    const sample = await prisma.$queryRawUnsafe<
      {
        ciphertext: string;
        iv: string;
        ratchetIndex: number;
        senderId: string;
      }[]
    >(
      `select ciphertext, iv, "ratchetIndex", "senderId" from messages
       where "conversationId" = $1 order by random() limit $2`,
      conversationId,
      sampleSize
    );
    const started = Date.now();
    let textRows = 0;
    let unreadable = 0;
    for (const row of sample) {
      const payload = await decryptMessage(
        rootKey,
        row.senderId,
        conversationId,
        row
      ).catch(() => null);
      if (!payload) {
        unreadable += 1;
      } else if (payload.type === "text") {
        textRows += 1;
      }
    }
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `  decrypt    ${sample.length} random rows in ${seconds.toFixed(2)}s = ${Math.round(sample.length / Math.max(seconds, 0.001))}/s single-threaded (${textRows} text, ${unreadable} unreadable)`
    );
  }

  // ---- 2. index every message ---------------------------------------------
  const store = createMemorySearchIndexStore();
  const baseKeyBySender = new Map<string, CryptoKey>();
  for (const senderId of [senderA, senderB]) {
    baseKeyBySender.set(senderId, await importRatchetBaseKey(rootKey));
  }

  // Ground truth for the probes, counted from decrypted text as it streams past.
  // Comparing the index against this is what makes the run self-validating.
  const truth = new Map<string, number>(probes.map((word) => [word, 0]));
  const tokenTruth = new Map<string, number>();
  // The persistent backend's token dictionary, accumulated here so the per-
  // keystroke measurement below can report what the production shape really
  // holds: one point read for the dictionary, one per typed word for its posting
  // list, and one per matched row.
  const dictionary: string[] = [];
  const tokenIdByText = new Map<string, number>();

  let lastId: string | undefined;
  let indexed = 0;
  let skippedNoText = 0;
  let nonText = 0;
  let undecryptable = 0;
  const indexStarted = Date.now();
  const decryptStarted = Date.now();

  for (;;) {
    // Cursor paging on id, the same axis the client's history walk uses, so this
    // also proves the server-side paging stays usable at 200k rows.
    const batch = await prisma.message.findMany({
      orderBy: { id: "asc" },
      take: batchSize,
      ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}),
      where: { conversationId },
    });
    if (batch.length === 0) {
      break;
    }
    lastId = batch[batch.length - 1]?.id;

    const entries = new Map<string, SearchIndexEntry>();
    for (const row of batch) {
      const baseKey = baseKeyBySender.get(row.senderId);
      if (!baseKey) {
        continue;
      }
      const payload = await decryptMessage(
        rootKey,
        row.senderId,
        conversationId,
        {
          ciphertext: row.ciphertext,
          iv: row.iv,
          ratchetIndex: row.ratchetIndex,
        }
      ).catch(() => null);
      if (!payload) {
        // One unddecryptable row must not end the run, and must not be counted as
        // searchable. This mirrors the client, which degrades a single unreadable
        // row rather than breaking the transcript. The conversation currently holds
        // exactly one such row: a leftover probe with iv="probe".
        undecryptable += 1;
        continue;
      }
      if (payload.type !== "text") {
        nonText += 1;
        continue;
      }
      const { text } = extractSearchableText(
        payload as Parameters<typeof extractSearchableText>[0]
      );
      // Count ground truth on the lowercased text, matching what the tokenizer
      // would see, without depending on the tokenizer itself.
      const haystack = text.toLowerCase();
      for (const word of probes) {
        if (haystack.includes(word)) {
          truth.set(word, (truth.get(word) ?? 0) + 1);
        }
      }
      const entry = buildSearchIndexEntry({
        createdAt: row.createdAt.getTime(),
        senderId: row.senderId,
        text,
      });
      if (!entry) {
        skippedNoText += 1;
        continue;
      }
      for (const token of entry.tokens) {
        tokenTruth.set(token, (tokenTruth.get(token) ?? 0) + 1);
        if (!tokenIdByText.has(token)) {
          tokenIdByText.set(token, tokenIdByText.size);
          dictionary.push(token);
        }
      }
      entries.set(row.id, entry);
    }
    if (entries.size > 0) {
      await store.putEntries(conversationId, entries);
    }
    indexed += batch.length;
    if (indexed % 50_000 === 0) {
      const seconds = (Date.now() - indexStarted) / 1000;
      console.log(
        `  indexed    ${indexed}/${total} (${Math.round(indexed / Math.max(seconds, 0.001))}/s) heap ${heapMb()}`
      );
    }
  }

  const indexSeconds = (Date.now() - indexStarted) / 1000;
  const stats = await store.readStats(conversationId);
  const distinctTokens = tokenTruth.size;
  console.log(
    `  indexed    ${indexed} messages in ${indexSeconds.toFixed(1)}s = ${Math.round(indexed / Math.max(indexSeconds, 0.001))}/s (decrypt + extract + intern)`
  );
  console.log(
    `  rows       ${stats.indexedRowCount} interned, ${distinctTokens} distinct tokens, ${nonText} non-text skipped, ${skippedNoText} with no searchable text`
  );
  if (undecryptable > 0) {
    console.log(
      `  UNREADABLE ${undecryptable} row(s) could not be decrypted and were skipped, as the client would`
    );
  }
  console.log(`  heap       ${heapMb()} after indexing a 200k conversation`);

  // ---- 3. query correctness and latency -----------------------------------
  console.log(
    "\n  probe            indexed   ground truth   rows   verdict     latency"
  );
  let failures = 0;
  // Budget overruns are counted apart from correctness failures so the summary
  // can say which of the two went wrong: a wrong answer is a correctness bug, a
  // slow one is a budget bug, and they get fixed by different people.
  let budgetFailures = 0;
  const CAP = 50;
  for (const word of probes) {
    // Warm once so the number is not dominated by a lazy first derive.
    await store.query(conversationId, [word], CAP);
    const samples: number[] = [];
    let result = await store.query(conversationId, [word], CAP);
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      result = await store.query(conversationId, [word], CAP);
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    const expected = truth.get(word) ?? 0;
    // `totalMatched` is the full intersection size, NOT capped; `rows` is what the
    // limit caps. Asserting the count against the truth is the real correctness
    // check, and the cap is a separate property.
    const ok = result.totalMatched === expected && result.rows.size <= CAP;
    if (!ok) {
      failures += 1;
    }
    console.log(
      `  ${word.padEnd(16)} ${String(result.totalMatched).padStart(7)} ${String(expected).padStart(13)} ${String(result.rows.size).padStart(6)}   ${ok ? "ok" : "MISMATCH"}   ${median.toFixed(1)}ms`
    );
  }

  // A two-word AND, and an AND with a word that does not exist. The second is the
  // one that silently degraded to a single-word search when unknown tokens were
  // dropped instead of sinking the query.
  const [common] = probes.filter((word) => (truth.get(word) ?? 0) > 0);
  if (common) {
    const both = await store.query(conversationId, [common, "index"], 50);
    const sink = await store.query(
      conversationId,
      [common, "nonexistentword"],
      50
    );
    console.log(
      `\n  AND "${common}"+"index"      -> ${both.totalMatched} matches`
    );
    console.log(
      `  AND "${common}"+"nonexistentword" -> ${sink.totalMatched} matches (must be 0)`
    );
    if (sink.totalMatched !== 0) {
      failures += 1;
      console.log("  MISMATCH: an unknown word did not sink the query");
    }
  }

  // ---- 4. what a keystroke actually costs in the BROWSER --------------------
  //
  // The latencies above come from the in-memory backend, whose query path is
  // close to production's shape but has no storage. The real backend is
  // IndexedDB and answers a keystroke with a fixed number of point reads: the
  // conversation header (the token dictionary, whose ORDER defines the posting
  // ids), one posting list per typed word, and one row record per matched row
  // inside the result cap. There is no cryptography on this path at all, and no
  // step whose cost grows with the conversation.
  //
  // This measures the two CPU-side halves of that -- the intersection and the row
  // projection -- against the index just built, so the browser number is a
  // prediction rather than a surprise. The point reads themselves are IndexedDB's
  // cost and need a browser.
  console.log(
    "\n  per-keystroke cost at 201k rows (production-shaped, not the test double):"
  );
  const probeWord =
    probes.find((word) => (truth.get(word) ?? 0) > 0) ?? "index";
  const tokenId = dictionary.indexOf(probeWord);
  const postingList = await store.readPostingList(conversationId, probeWord);

  const benchList = {
    rows: postingList,
    times: await store.readPostingTimes(conversationId, probeWord),
  };
  const intersectSamples: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    intersectPostingLists([benchList]);
    intersectSamples.push(performance.now() - started);
  }
  intersectSamples.sort((left, right) => left - right);
  const intersectMs = intersectSamples[1] ?? 0;
  // Intersect, then order and cut the window: the two halves a keystroke pays.
  const { matches } = intersectPostingLists([benchList]);
  const orderStarted = performance.now();
  const window = selectNewestFirstWindow(matches, 50);
  const orderMs = performance.now() - orderStarted;

  const projectStarted = performance.now();
  const projected = await store.readRows(
    conversationId,
    Uint32Array.from(window.window.map((match) => match.row))
  );
  const projectMs = performance.now() - projectStarted;

  console.log(`    posting intersect       ${intersectMs.toFixed(2)}ms`);
  console.log(
    `    order ${matches.length} matches     ${orderMs.toFixed(2)}ms`
  );
  console.log(
    `    resolve ${window.window.length} window rows     ${projectMs.toFixed(2)}ms`
  );
  const cpuMs = intersectMs + orderMs + projectMs;
  console.log(`    cpu per query           ${cpuMs.toFixed(2)}ms`);
  // The one budget this harness can honestly check. It is the REFERENCE budget,
  // because this is the in-memory path; the browser budget is checked by opening
  // the app, and asserting it here would be measuring the wrong backend.
  const overBudget = cpuMs > REFERENCE_QUERY_SLO_MS;
  if (overBudget) {
    budgetFailures += 1;
  }
  console.log(
    `    budget (${REFERENCE_QUERY_SLO_MS}ms)  ${overBudget ? "OVER" : "ok"}`
  );
  console.log(
    `    (sanity: token id ${tokenId}, resolved ${projected.size} rows for "${probeWord}", dictionary ${dictionary.length} entries)`
  );
  console.log(
    "\n  Nothing here scales with the conversation: the dictionary is one point read,\n  the posting lists are one per typed word, and the row reads are bounded by the\n  result cap. An earlier design sealed the whole row table per write, which cost\n  ~1.4s of synchronous AES per 500-message page and starved every other read."
  );

  console.log(
    failures === 0
      ? "\n  RESULT: all probes match ground truth"
      : `\n  RESULT: ${failures} probe(s) MISMATCHED`
  );
  if (budgetFailures > 0) {
    console.log(
      `\n  BUDGET: ${budgetFailures} check(s) over REFERENCE_QUERY_SLO_MS`
    );
  }
  if (failures > 0 || budgetFailures > 0) {
    // A non-zero exit is what makes this usable as a gate. Printing a number and
    // exiting zero is how a budget becomes a comment.
    process.exitCode = 1;
  }
  console.log(
    "\n  Not covered here (needs a browser): the IndexedDB backend, per-origin\n  quota and eviction, Safari private-mode fallback, and the backfill's\n  25-pages-per-run pacing. See the manual checklist."
  );
}

await main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
