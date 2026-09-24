import type { PrismaTransaction } from "@asm/db";

export interface MediaDerivativeInsert {
  durationMs?: number;
  key: string;
  kind: string;
  mimeType: string;
  pipelineVersion: string;
  sizeBytes?: number;
  variant: string;
}

export async function persistMediaDerivatives(
  transaction: PrismaTransaction,
  mediaId: string,
  derivatives: readonly MediaDerivativeInsert[]
): Promise<void> {
  for (const derivative of derivatives) {
    const matching = transaction.orm.public.PostMediaDerivatives.where({
      mediaId,
    })
      .where({ kind: derivative.kind })
      .where({ variant: derivative.variant });
    const existing = await matching.first();
    if (existing) {
      continue;
    }
    try {
      await transaction.orm.public.PostMediaDerivatives.create({
        id: crypto.randomUUID(),
        ...derivative,
        mediaId,
      });
    } catch (error) {
      const raced = await matching.first();
      if (!raced) {
        throw error;
      }
    }
  }
}
