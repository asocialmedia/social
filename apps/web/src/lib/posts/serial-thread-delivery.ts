// Policy reads are asynchronous; preserve create/delete order and disconnect a slow consumer before its queue grows without bound.
export function serialThreadDelivery(
  deliver: (message: string) => Promise<void>,
  close: () => void,
  maxPending = 64
) {
  let pending = Promise.resolve();
  let queued = 0;
  let closed = false;
  return (message: string) => {
    if (closed) {
      return pending;
    }
    if (queued >= maxPending) {
      closed = true;
      close();
      return pending;
    }
    queued += 1;
    // oxlint-disable-next-line promise/prefer-await-to-then -- chain each event behind the preceding policy check.
    pending = pending.then(async () => {
      try {
        if (!closed) {
          await deliver(message);
        }
      } catch {
        closed = true;
        close();
      } finally {
        queued -= 1;
      }
    });
    return pending;
  };
}
