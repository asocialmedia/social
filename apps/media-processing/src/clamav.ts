// Minimal ClamAV clamd client using the INSTREAM protocol: the file is
// streamed to the daemon in length-prefixed chunks over a TCP socket, so no
// temp files are shared across containers and no npm dependency is needed.
// Protocol: "zINSTREAM\0" then [u32 BE length][chunk]* then a zero-length
// chunk; the daemon replies "stream: OK" or "stream: <name> FOUND".

import { workerEnv } from "./env";

export interface ClamAvVerdict {
  clean: boolean;
  signature?: string;
}

export class ClamAvUnavailableError extends Error {
  override name = "ClamAvUnavailableError";
}

export function parseResponse(raw: string): ClamAvVerdict {
  // Responses look like "stream: OK\0" or "stream: Eicar-Signature FOUND\0".
  const trimmed = raw.replaceAll("\0", "").trim();
  if (/^stream: OK$/i.test(trimmed) || /^OK$/i.test(trimmed)) {
    return { clean: true };
  }
  const found = trimmed.match(/^(?:stream|.*?):\s*(?<signature>.+?)\s+FOUND$/i);
  if (found?.groups?.signature) {
    return { clean: false, signature: found.groups.signature };
  }
  throw new ClamAvUnavailableError(
    `Unrecognized clamd response: ${trimmed.slice(0, 200)}`
  );
}

export async function scanStream(
  source: ReadableStream<Uint8Array>,
  timeoutMs: number
): Promise<ClamAvVerdict> {
  if (!workerEnv.CLAMAV_HOST) {
    throw new ClamAvUnavailableError("CLAMAV_HOST is not configured");
  }

  // Declared before the socket exists so callbacks can never observe TDZ.
  const responseChunks: Uint8Array[] = [];
  let failure: Error | null = null;

  let socket;
  try {
    socket = await Bun.connect({
      hostname: workerEnv.CLAMAV_HOST,
      port: workerEnv.CLAMAV_PORT,
      socket: {
        data(_socket, chunk) {
          responseChunks.push(new Uint8Array(chunk));
        },
        error(_socket, error) {
          failure = new ClamAvUnavailableError(
            `clamd socket error: ${String(error)}`
          );
        },
      },
    });
  } catch (error) {
    // Connect refusal/timeouts are scanner-availability problems, never
    // evidence about the file being scanned.
    throw new ClamAvUnavailableError(
      `clamd unreachable at ${workerEnv.CLAMAV_HOST}:${workerEnv.CLAMAV_PORT}: ${String(error)}`
    );
  }

  const reader = source.getReader();
  // Overall deadline covers the WHOLE exchange - source reads and INSTREAM
  // writes included. Previously only the verdict wait was bounded, so a
  // daemon stalling mid-transfer pinned the media row in SCANNING forever.
  const deadline = Date.now() + timeoutMs;
  const assertTimeLeft = (): void => {
    if (Date.now() > deadline) {
      throw new ClamAvUnavailableError(
        `clamd INSTREAM exchange exceeded ${timeoutMs}ms`
      );
    }
  };
  try {
    assertTimeLeft();
    await socket.write(new TextEncoder().encode("zINSTREAM\0"));

    // The INSTREAM framing is order-sensitive; chunks must be written
    // sequentially or the daemon reassembles a corrupt byte stream.
    // oxlint-disable-next-line no-await-in-loop -- ordered socket framing
    for (;;) {
      assertTimeLeft();
      // oxlint-disable-next-line no-await-in-loop -- ordered socket framing
      // oxlint-disable-next-line no-await-in-loop -- ordered socket framing
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }
      const framed = new Uint8Array(4 + value.length);
      new DataView(framed.buffer).setUint32(0, value.length, false);
      framed.set(value, 4);
      // oxlint-disable-next-line no-await-in-loop -- ordered socket framing
      // oxlint-disable-next-line no-await-in-loop -- ordered socket framing
      await socket.write(framed);
    }
    assertTimeLeft();
    // Zero-length chunk terminates the stream; the verdict follows.
    await socket.write(new Uint8Array(4));

    // oxlint-disable-next-line no-await-in-loop -- bounded polling loop
    for (;;) {
      if (failure) {
        throw failure;
      }
      const joined = Buffer.concat(responseChunks);
      const terminatorAt = joined.indexOf(0);
      if (terminatorAt !== -1) {
        return parseResponse(joined.toString("latin1", 0, terminatorAt + 1));
      }
      if (Date.now() > deadline) {
        throw new ClamAvUnavailableError("clamd verdict timed out");
      }
      // oxlint-disable-next-line no-await-in-loop -- bounded polling
      // oxlint-disable-next-line no-await-in-loop -- bounded polling
      await Bun.sleep(25);
    }
  } finally {
    reader.releaseLock();
    socket.end();
  }
}
