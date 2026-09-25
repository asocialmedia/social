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

export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { iv: toBufferSource(nonce), name: "AES-GCM" },
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
  sealed: Uint8Array
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
      { iv: toBufferSource(nonce), name: "AES-GCM" },
      key,
      toBufferSource(ciphertext)
    )
  );
}

// ---- row table codec ---------------------------------------------------------

// A decoded row table, in the shape the query path wants.
export interface SealedRowTable {
  createdAtByRow: number[];
  messageIdByRow: string[];
  senderIdByRow: string[];
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Row table encoding. Sender ids are interned because a conversation has one or
// two participants, so storing a repeated id per row would be the bulk of the
// buffer for no information.
//
//   u32 senderCount
//   senderCount * (u16 len + utf8 bytes)
//   u32 rowCount
//   rowCount * (u16 idLen + utf8 id + f64 createdAt + u16 senderIndex)
//
// Row ids are implicit and dense, matching the index's allocator, so they are not
// stored.
export function encodeRowTable(table: SealedRowTable): Uint8Array {
  const senders: string[] = [];
  const senderIndex = new Map<string, number>();
  for (const senderId of table.senderIdByRow) {
    if (!senderIndex.has(senderId)) {
      senderIndex.set(senderId, senders.length);
      senders.push(senderId);
    }
  }
  const ids = table.messageIdByRow.map((id) => ENCODER.encode(id));
  const senderBytes = senders.map((id) => ENCODER.encode(id));

  let size = 4 + 4;
  for (const bytes of senderBytes) {
    size += 2 + bytes.length;
  }
  for (const bytes of ids) {
    size += 2 + bytes.length + 8 + 2;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint32(offset, senders.length, false);
  offset += 4;
  for (const bytes of senderBytes) {
    view.setUint16(offset, bytes.length, false);
    offset += 2;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  view.setUint32(offset, ids.length, false);
  offset += 4;
  for (let row = 0; row < ids.length; row += 1) {
    const bytes = ids[row] ?? new Uint8Array(0);
    view.setUint16(offset, bytes.length, false);
    offset += 2;
    out.set(bytes, offset);
    offset += bytes.length;
    view.setFloat64(offset, table.createdAtByRow[row] ?? 0, false);
    offset += 8;
    view.setUint16(
      offset,
      senderIndex.get(table.senderIdByRow[row] ?? "") ?? 0,
      false
    );
    offset += 2;
  }
  return out;
}

export function decodeRowTable(bytes: Uint8Array): SealedRowTable {
  if (bytes.length < 8) {
    throw new Error("index vault: row table too short");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const senderCount = view.getUint32(offset, false);
  offset += 4;
  const senders: string[] = [];
  for (let index = 0; index < senderCount; index += 1) {
    const length = view.getUint16(offset, false);
    offset += 2;
    senders.push(DECODER.decode(bytes.subarray(offset, offset + length)));
    offset += length;
  }
  const rowCount = view.getUint32(offset, false);
  offset += 4;
  const messageIdByRow: string[] = [];
  const createdAtByRow: number[] = [];
  const senderIdByRow: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const idLength = view.getUint16(offset, false);
    offset += 2;
    messageIdByRow.push(
      DECODER.decode(bytes.subarray(offset, offset + idLength))
    );
    offset += idLength;
    createdAtByRow.push(view.getFloat64(offset, false));
    offset += 8;
    senderIdByRow.push(senders[view.getUint16(offset, false)] ?? "");
    offset += 2;
  }
  return { createdAtByRow, messageIdByRow, senderIdByRow };
}

// Seals a row table, so callers deal in one opaque record.
export function sealRowTable(
  key: CryptoKey,
  table: SealedRowTable
): Promise<Uint8Array> {
  return seal(key, encodeRowTable(table));
}

export async function unsealRowTable(
  key: CryptoKey,
  sealed: Uint8Array
): Promise<SealedRowTable> {
  return decodeRowTable(await unseal(key, sealed));
}
