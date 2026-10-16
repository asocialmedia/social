// Counts payload bytes offered by origin responses; CDN cache hits and cancelled
// transfers require CDN analytics to measure actual client network usage.
export async function recordDeliveryPayload(
  bytes: number | null | undefined
): Promise<void> {
  if (bytes === undefined || bytes === null) {
    return;
  }
  try {
    const { recordMediaDelivery } = await import("@asm/db");
    await recordMediaDelivery(bytes);
  } catch {
    // Observability cannot prevent media delivery.
  }
}
