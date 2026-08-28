// ClamAV clamd INSTREAM client. The file is streamed to the daemon in
// length-prefixed chunks; the daemon replies "stream: OK" or
// "stream: <name> FOUND".
//
// Transport: a netcat subprocess. Bun 1.4's Bun.connect() socket.write
// silently discards data under TCP backpressure (a slow reader - exactly
// what clamd is while it allocates scan buffers - receives ~10% of a 26MB
// stream, verified against both a Bun listener and real netcat), which
// corrupts the length-prefix framing and surfaces as bogus "INSTREAM size
// limit exceeded" verdicts. A subprocess pipe gets kernel-level flow
// control: stdin write() blocks until consumed, so framing is guaranteed.
// nc ships in the worker image (netcat-openbsd, see Dockerfile).

import { ClamAvSizeLimitError } from "./clamav-size-limit-error";
import { workerEnv } from "./env";

export {
  // Raised when clamd answers INSTREAM size limit exceeded: the file
  // exceeds the daemon's StreamMaxLength. A property of the FILE, not the
  // scanner - callers reject the upload instead of retrying.
  ClamAvSizeLimitError,
} from "./clamav-size-limit-error";

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
  if (/size limit exceeded/i.test(trimmed)) {
    throw new ClamAvSizeLimitError(trimmed.slice(0, 200));
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

  let proc;
  try {
    proc = Bun.spawn(
      ["nc", workerEnv.CLAMAV_HOST, String(workerEnv.CLAMAV_PORT)],
      { stderr: "pipe", stdin: "pipe", stdout: "pipe" }
    );
  } catch (error) {
    // Spawn failure is a scanner-availability problem, never evidence
    // about the file being scanned.
    throw new ClamAvUnavailableError(
      `nc bridge failed to start for ${workerEnv.CLAMAV_HOST}:${workerEnv.CLAMAV_PORT}: ${String(error)}`
    );
  }

  const reader = source.getReader();
  // Overall deadline covers the WHOLE exchange - source reads and INSTREAM
  // writes included. A daemon stalling mid-transfer must not pin the media
  // row in SCANNING forever.
  const deadline = Date.now() + timeoutMs;
  const assertTimeLeft = (): void => {
    if (Date.now() > deadline) {
      throw new ClamAvUnavailableError(
        `clamd INSTREAM exchange exceeded ${timeoutMs}ms`
      );
    }
  };

  const readResponse = (async () => {
    const response = await new Response(proc.stdout).text();
    return parseResponse(response);
  })();

  try {
    assertTimeLeft();
    // stdin.write returns a Promise that resolves under real backpressure,
    // so the ordered INSTREAM framing cannot desync the way the raw socket
    // writes could.
    await proc.stdin.write(new TextEncoder().encode("zINSTREAM\0"));

    for (;;) {
      assertTimeLeft();
      // oxlint-disable-next-line no-await-in-loop -- ordered stream consumption
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
      await proc.stdin.write(framed);
    }
    assertTimeLeft();
    // Zero-length chunk terminates the stream; the verdict follows.
    await proc.stdin.write(new Uint8Array(4));
    await proc.stdin.end();

    return await readResponse;
  } catch (error) {
    // Drop the race loser so a stuck exchange cannot leak the process.
    proc.kill();
    throw error;
  } finally {
    reader.releaseLock();
  }
  // readResponse is not awaited in finally on the success path; on timeout
  // or error the kill above terminates nc and the response promise settles
  // discarded (any rejection is prevented by the kill closing stdout).
}
