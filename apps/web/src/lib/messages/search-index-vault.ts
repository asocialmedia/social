// Sealing for the local search index's row table.
//
// Why a vault rather than encrypting each row: WebCrypto costs a fixed overhead
// per operation, and a query resolves up to 2,000 rows. Encrypting them one at a
// time was measured at roughly 0.2ms of overhead each, so ~400ms per keystroke —
// unusable. The row table is therefore serialized into one buffer and sealed as a
// single AEAD record.
//
// The cost of that choice is that a query decrypts the whole table, about 8MB at
// 200k messages, which is a few milliseconds of AES. That is the price of not
// publishing a per-message word oracle, and it stays far inside the 100ms query
// budget. The decrypted buffer is released as soon as the matched rows are
// extracted, so it is transient rather than resident.
//
// Wire format, deliberately explicit and versioned rather than a structured clone,
// because a stored index has to survive a change of this file:
//
//   0      1      4                  8
//   | ver  | ctLen | nonce (12)      | ciphertext+GCM tag (ctLen) |
//
// AES-GCM is used in its default 128-bit tag configuration. The nonce is fresh per
// seal and never reused under one key, which is the property GCM actually requires;
// sealing is not deterministic and must not be, or equal tables would be
// comparable by an attacker.

const VERSION = 1;
const NONCE_BYTES = 12;
const HEADER_BYTES = 1 + 4 + NONCE_BYTES;

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

// Associated data is authenticated but not encrypted. Binding the conversation
// and key generation into it means a blob cannot be replayed into another
// conversation's store, or read under a different key epoch, even if someone
// holds the same raw key: GCM rejects the record before it is ever parsed.
export interface SealContext {
  conversationId: string;
  // Changes whenever the conversation root is replaced, so bytes sealed under a
  // superseded root are refused rather than silently decrypted.
  keyGeneration: string;
}

function contextBytes(context: SealContext): Uint8Array {
  return ENCODER.encode(
    `${context.conversationId}\u0000${context.keyGeneration}`
  );
}

export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array,
  context: SealContext
): Promise<Uint8Array> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        additionalData: toBufferSource(contextBytes(context)),
        iv: toBufferSource(nonce),
        name: "AES-GCM",
      },
      key,
      toBufferSource(plaintext)
    )
  );
  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  const view = new DataView(out.buffer);
  out[0] = VERSION;
  view.setUint32(1, ciphertext.length, false);
  out.set(nonce, 5);
  out.set(ciphertext, HEADER_BYTES);
  return out;
}

export async function unseal(
  key: CryptoKey,
  sealed: Uint8Array,
  context: SealContext
): Promise<Uint8Array> {
  if (sealed.length < HEADER_BYTES) {
    throw new Error("index vault: truncated header");
  }
  if ((sealed[0] ?? 0) !== VERSION) {
    throw new Error(`index vault: unsupported version ${sealed[0]}`);
  }
  const view = new DataView(
    sealed.buffer,
    sealed.byteOffset,
    sealed.byteLength
  );
  const ciphertextLength = view.getUint32(1, false);
  if (sealed.length !== HEADER_BYTES + ciphertextLength) {
    throw new Error("index vault: length does not match header");
  }
  const nonce = sealed.subarray(5, 5 + NONCE_BYTES);
  const ciphertext = sealed.subarray(HEADER_BYTES);
  // A failure here is either a wrong key or tampering. Both are treated the same
  // way on purpose: the caller cannot tell them apart, and either way the correct
  // response is to rebuild the index rather than serve wrong results.
  return new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      {
        additionalData: toBufferSource(contextBytes(context)),
        iv: toBufferSource(nonce),
        name: "AES-GCM",
      },
      key,
      toBufferSource(ciphertext)
    )
  );
}

// ---- row table codec ---------------------------------------------------------

// The complete logical table, sealed as one record.
//
// This carries strictly more than the query path needs, and deliberately so: the
// WRITE path needs each row's tokens (to know which posting lists a rewrite or a
// removal must clear) and needs tombstones (so a deleted message leaves a marker
// rather than a hole that an older device would refill). A codec that held only
// what queries read could not be the source of truth for writes, and the write
// path is the one that must not lose track of a deletion.
//
// Row ids are implicit and dense, matching the index's allocator, so they are not
// stored. Tokens and sender ids are interned into dictionaries because a
// conversation has one or two participants and a bounded vocabulary: storing a
// repeated string per row would be most of the buffer for no information.
export interface SealedRowTable {
  createdAtByRow: number[];
  messageIdByRow: string[];
  senderIdByRow: string[];
  // Tokens per row, in the same order the persistent index holds them.
  tokensByRow: string[][];
  // True while the row is live. A false row is a tombstone: the row existed, its
  // message was deleted or hidden, and the id is retained so the deletion is not
  // undone by a stale device. Tombstoned rows contribute no tokens.
  presentByRow: boolean[];
  // The token dictionary, in STABLE id order. A persistent backend keys its
  // posting lists by these ids, so the order must not shift: deriving a sorted
  // dictionary per encode would renumber every list the moment a word sorting
  // earlier was first used, silently corrupting the index. Absent means "derive
  // one", which is only correct for a table that is not yet persisted.
  tokenDictionary?: string[];
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Wire layout. All integers big-endian, matching the original codec, so a table
// written by one build is byte-comparable by another.
//
//   u16 senderCount          then senderCount * (u16 len + utf8)
//   u32 tokenCount           then tokenCount * (u16 len + utf8)
//   u32 rowCount
//   u32 packedTokenCount     (so the vector's length is known without walking
//                             the directory)
//   u32 directoryOffset      (absolute, so a projection can seek without parsing
//                             the dictionaries)
//   rowCount * 24 bytes of fixed directory, one entry per row:
//     u8  present bit
//     u8  pad, reserved (0)
//     u16 messageId length
//     u32 messageId offset
//     f64 createdAt
//     u16 sender index
//     u32 token offset (index into the per-row token-id vector)
//     u16 token count
//   packedTokenCount * 4 bytes (the u32 token-id vector)
//   variable-length message ids, in row order
//
// The dictionary count and each token reference are u32: a dictionary can
// exceed 65,535 distinct tokens, and the count is a whole-table quantity. The
// offsets are u32 because they are whole-table quantities.
//
// The fixed directory is what lets a query resolve 2,000 rows without decoding
// 200,000: the projection reads the directory, gathers the requested message ids
// and sender indices, and never materialises the rest.
const DIRECTORY_ENTRY_BYTES = 24;
// The fixed header is split because the dictionaries sit in the middle of it:
// the two counts precede them, and the row count, packed-token count and
// directory offset follow. Sizing it as one block under-counted the buffer by
// twelve bytes and every non-empty table overran its own allocation.
const HEADER_PREFIX_BYTES = 6; // u16 senderCount + u32 tokenCount
const HEADER_TAIL_BYTES = 12; // u32 rowCount + u32 packedTokenCount + u32 offset

export function encodeRowTable(table: SealedRowTable): Uint8Array {
  const rowCount = table.messageIdByRow.length;
  if (table.createdAtByRow.length !== rowCount) {
    throw new Error(
      "index vault: createdAtByRow length does not match messageIdByRow"
    );
  }
  if (table.senderIdByRow.length !== rowCount) {
    throw new Error(
      "index vault: senderIdByRow length does not match messageIdByRow"
    );
  }
  if (table.presentByRow.length !== rowCount) {
    throw new Error(
      "index vault: presentByRow length does not match messageIdByRow"
    );
  }
  if (table.tokensByRow.length !== rowCount) {
    throw new Error(
      "index vault: tokensByRow length does not match messageIdByRow"
    );
  }

  // Senders keep insertion order: there are one or two of them. Tokens come from
  // the table's own dictionary when it has one, so a stored index's ids are
  // stable across re-encodes; otherwise a sorted dictionary is derived, which is
  // deterministic and therefore still byte-stable for the same content.
  const senders: string[] = [];
  const senderIndex = new Map<string, number>();
  for (const senderId of table.senderIdByRow) {
    if (!senderIndex.has(senderId)) {
      senderIndex.set(senderId, senders.length);
      senders.push(senderId);
    }
  }
  const tokenText =
    table.tokenDictionary ?? [...new Set(table.tokensByRow.flat())].toSorted();
  if (senders.length > 0xff_ff) {
    throw new Error("index vault: sender count exceeds u16 capacity");
  }
  if (tokenText.length > 0xff_ff_ff_ff) {
    throw new Error("index vault: token count exceeds u32 capacity");
  }
  const tokenIndex = new Map<string, number>();
  for (const [index, token] of tokenText.entries()) {
    tokenIndex.set(token, index);
  }
  const senderBytes = senders.map((sender) => ENCODER.encode(sender));
  const tokenBytes = tokenText.map((token) => ENCODER.encode(token));
  const messageIdBytes = table.messageIdByRow.map((id) => ENCODER.encode(id));

  // Tokens are packed per row, in row order, with each row's slice recorded in
  // the directory.
  const packedTokens: number[] = [];
  const packedOffsetByRow: number[] = [];
  for (const [row, tokens] of table.tokensByRow.entries()) {
    packedOffsetByRow.push(packedTokens.length);
    for (const token of tokens) {
      const tokenId = tokenIndex.get(token);
      if (tokenId === undefined) {
        throw new Error(
          `index vault: row ${row} references a token outside the dictionary`
        );
      }
      packedTokens.push(tokenId);
    }
  }

  // The directory follows the whole header, so its absolute offset is always past
  // it. An earlier layout pointed the directory-offset field at itself and placed
  // the packed token vector where the directory began, so an empty table had two
  // structures on the same byte.
  let size = HEADER_PREFIX_BYTES;
  for (const bytes of senderBytes) {
    size += 2 + bytes.length;
  }
  for (const bytes of tokenBytes) {
    size += 2 + bytes.length;
  }
  size += HEADER_TAIL_BYTES;
  size += rowCount * DIRECTORY_ENTRY_BYTES;
  size += packedTokens.length * 4;
  for (const bytes of messageIdBytes) {
    size += bytes.length;
  }

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;

  view.setUint16(offset, senderBytes.length, false);
  offset += 2;
  for (const bytes of senderBytes) {
    view.setUint16(offset, bytes.length, false);
    offset += 2;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  view.setUint32(offset, tokenBytes.length, false);
  offset += 4;
  for (const bytes of tokenBytes) {
    view.setUint16(offset, bytes.length, false);
    offset += 2;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  view.setUint32(offset, rowCount, false);
  offset += 4;
  view.setUint32(offset, packedTokens.length, false);
  offset += 4;
  // The directory starts AFTER this field, not at it. Pointing the field at
  // itself would put the first directory entry on top of the offset.
  const directoryOffset = offset + 4;
  view.setUint32(offset, directoryOffset, false);
  offset += 4;

  // The packed token vector follows the directory, then the variable-length ids.
  const packedTokensOffset = directoryOffset + rowCount * DIRECTORY_ENTRY_BYTES;
  // No count field in the body any more: it moved into the header, so this is
  // simply the directory plus the packed vector. Leaving a stray +4 here pushed
  // every message id four bytes past the end of its own buffer.
  let messageIdOffset = packedTokensOffset + packedTokens.length * 4;

  for (let row = 0; row < rowCount; row += 1) {
    const base = directoryOffset + row * DIRECTORY_ENTRY_BYTES;
    const idBytes = messageIdBytes[row] ?? new Uint8Array(0);
    out[base] = table.presentByRow[row] === true ? 1 : 0;
    out[base + 1] = 0;
    view.setUint16(base + 2, idBytes.length, false);
    view.setUint32(base + 4, messageIdOffset, false);
    view.setFloat64(base + 8, table.createdAtByRow[row] ?? 0, false);
    view.setUint16(
      base + 16,
      senderIndex.get(table.senderIdByRow[row] ?? "") ?? 0,
      false
    );
    view.setUint32(base + 18, packedOffsetByRow[row] ?? 0, false);
    view.setUint16(base + 22, table.tokensByRow[row]?.length ?? 0, false);
    out.set(idBytes, messageIdOffset);
    messageIdOffset += idBytes.length;
  }

  let cursor = packedTokensOffset;
  for (const id of packedTokens) {
    view.setUint32(cursor, id, false);
    cursor += 4;
  }
  return out;
}

interface TableHeader {
  directoryOffset: number;
  packedTokenCount: number;
  rowCount: number;
  senderCount: number;
  tokenCount: number;
}

function readHeader(
  view: DataView,
  total: number
): TableHeader & { dictionaries: { senders: string[]; tokens: string[] } } {
  if (total < HEADER_PREFIX_BYTES + HEADER_TAIL_BYTES) {
    throw new Error("index vault: row table too short");
  }
  let offset = 0;
  const senderCount = view.getUint16(offset, false);
  offset += 2;
  const senders: string[] = [];
  for (let index = 0; index < senderCount; index += 1) {
    const length = view.getUint16(offset, false);
    offset += 2;
    if (offset + length > total) {
      throw new Error("index vault: sender dictionary overruns buffer");
    }
    senders.push(
      DECODER.decode(
        new Uint8Array(view.buffer, view.byteOffset + offset, length)
      )
    );
    offset += length;
  }
  const tokenCount = view.getUint32(offset, false);
  offset += 4;
  const tokens: string[] = [];
  for (let index = 0; index < tokenCount; index += 1) {
    const length = view.getUint16(offset, false);
    offset += 2;
    if (offset + length > total) {
      throw new Error("index vault: token dictionary overruns buffer");
    }
    tokens.push(
      DECODER.decode(
        new Uint8Array(view.buffer, view.byteOffset + offset, length)
      )
    );
    offset += length;
  }
  const rowCount = view.getUint32(offset, false);
  offset += 4;
  const packedTokenCount = view.getUint32(offset, false);
  offset += 4;
  const directoryOffset = view.getUint32(offset, false);
  offset += 4;
  if (
    directoryOffset !== offset ||
    directoryOffset + rowCount * DIRECTORY_ENTRY_BYTES + packedTokenCount * 4 >
      total
  ) {
    throw new Error("index vault: row directory is out of range");
  }
  return {
    dictionaries: { senders, tokens },
    directoryOffset,
    packedTokenCount,
    rowCount,
    senderCount,
    tokenCount,
  };
}

export function readTokenDictionary(bytes: Uint8Array): string[] {
  if (bytes.length < 16) {
    return [];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    return readHeader(view, bytes.length).dictionaries.tokens;
  } catch {
    return [];
  }
}

export function decodeRowTable(bytes: Uint8Array): SealedRowTable {
  if (bytes.length < 16) {
    throw new Error("index vault: row table too short");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readHeader(view, bytes.length);
  const { dictionaries, directoryOffset, rowCount } = header;

  const messageIdByRow: string[] = [];
  const createdAtByRow: number[] = [];
  const senderIdByRow: string[] = [];
  const presentByRow: boolean[] = [];
  const tokensByRow: string[][] = [];

  // The packed token vector sits immediately after the directory; its length
  // comes from the header, not from re-reading it here.
  const packedCursor = directoryOffset + rowCount * DIRECTORY_ENTRY_BYTES;
  const packedCount = header.packedTokenCount;

  for (let row = 0; row < rowCount; row += 1) {
    const base = directoryOffset + row * DIRECTORY_ENTRY_BYTES;
    const present = bytes[base] === 1;
    const idLength = view.getUint16(base + 2, false);
    const idOffset = view.getUint32(base + 4, false);
    const createdAt = view.getFloat64(base + 8, false);
    const senderIndex = view.getUint16(base + 16, false);
    const tokenOffset = view.getUint32(base + 18, false);
    const tokenCountForRow = view.getUint16(base + 22, false);
    if (idOffset + idLength > bytes.length) {
      throw new Error("index vault: message id overruns buffer");
    }
    if (
      (dictionaries.senders[senderIndex] === undefined && senderIndex !== 0) ||
      tokenOffset + tokenCountForRow > packedCount
    ) {
      throw new Error("index vault: directory references a missing entry");
    }
    messageIdByRow.push(
      DECODER.decode(
        new Uint8Array(bytes.buffer, bytes.byteOffset + idOffset, idLength)
      )
    );
    createdAtByRow.push(createdAt);
    senderIdByRow.push(dictionaries.senders[senderIndex] ?? "");
    presentByRow.push(present);
    const tokens: string[] = [];
    for (let index = 0; index < tokenCountForRow; index += 1) {
      const tokenId = view.getUint32(
        packedCursor + (tokenOffset + index) * 4,
        false
      );
      const token = dictionaries.tokens[tokenId];
      if (token === undefined) {
        throw new Error("index vault: row references a missing token");
      }
      tokens.push(token);
    }
    tokensByRow.push(tokens);
  }

  return {
    createdAtByRow,
    messageIdByRow,
    presentByRow,
    senderIdByRow,
    tokenDictionary: header.dictionaries.tokens,
    tokensByRow,
  };
}

// The facts a query needs for the rows it matched, resolved without materialising
// the rest of the table. This is what keeps search memory proportional to results
// after sealing: a 2,000-row result decodes 2,000 message ids, not 200,000.
export interface ProjectedRow {
  createdAt: number;
  messageId: string;
  senderId: string;
}

export function projectRowTable(
  bytes: Uint8Array,
  rowIds: Iterable<number>
): Map<number, ProjectedRow> {
  const out = new Map<number, ProjectedRow>();
  if (bytes.length < 16) {
    return out;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: ReturnType<typeof readHeader>;
  try {
    header = readHeader(view, bytes.length);
  } catch {
    // A malformed table yields no rows rather than throwing: the caller's
    // response to a corrupt index is to rebuild, and the projection is on the
    // keystroke path where a throw would be worse than an empty result.
    return out;
  }
  const { dictionaries, directoryOffset, rowCount } = header;
  for (const row of rowIds) {
    if (row < 0 || row >= rowCount) {
      continue;
    }
    const base = directoryOffset + row * DIRECTORY_ENTRY_BYTES;
    // A tombstone is skipped without decoding its id: the message is gone, so
    // resolving it to a searchable result would be wrong.
    if (bytes[base] !== 1) {
      continue;
    }
    const idLength = view.getUint16(base + 2, false);
    const idOffset = view.getUint32(base + 4, false);
    const senderIndex = view.getUint16(base + 16, false);
    if (idOffset + idLength > bytes.length) {
      continue;
    }
    out.set(row, {
      createdAt: view.getFloat64(base + 8, false),
      messageId: DECODER.decode(
        new Uint8Array(bytes.buffer, bytes.byteOffset + idOffset, idLength)
      ),
      senderId: dictionaries.senders[senderIndex] ?? "",
    });
  }
  return out;
}

// The key generation is deliberately NOT part of the blob. It is carried by the
// store record, and bound into the seal as associated data, so a record written
// under one root is refused under another. Repeating it inside the ciphertext
// would add a field that can never be trusted, since the whole point is that the
// bytes are only readable after the AEAD check.
//
// Every array must be fresh. A shallow spread of a module-level constant hands
// back the SAME array instances to every caller, and the write path mutates them
// in place (`table.messageIdByRow[row] = ...`). One conversation's first write
// would then be visible to the next conversation's "empty" table, in the same
// session and across tests, which is both a cross-conversation leak and a
// corruption of row numbering.
export function emptySealedRowTable(): SealedRowTable {
  return {
    createdAtByRow: [],
    messageIdByRow: [],
    presentByRow: [],
    senderIdByRow: [],
    tokenDictionary: [],
    tokensByRow: [],
  };
}

// Seals a row table, so callers deal in one opaque record.
export function sealRowTable(
  key: CryptoKey,
  table: SealedRowTable,
  context: SealContext
): Promise<Uint8Array> {
  return seal(key, encodeRowTable(table), context);
}

export function unsealRowTable(
  key: CryptoKey,
  sealed: Uint8Array,
  context: SealContext
): Promise<SealedRowTable> {
  return unseal(key, sealed, context).then(decodeRowTable);
}
