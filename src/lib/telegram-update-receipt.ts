// W9-D / TG-C-next — Telegram webhook update_id at-most-once claim.
//
// Pattern: ConsumedMagicLinkToken (UNIQUE @id + P2002 = replay) and
// MutationReceipt (same). Here P2002 means "this update_id was already
// accepted" → skip domain work (no second Photo / separateSlab).
//
// Why not MutationReceipt itself: that table is permanent (no expiresAt) for
// low-volume intake UUIDs. Webhook traffic is every bot update forever → needs
// TTL + prune or the table grows without bound.
//
// Retention: expiresAt = now + TELEGRAM_UPDATE_RECEIPT_TTL_MS (7 days). Telegram
// only retries for a short window and discards old updates; 7d >> retry window
// and keeps disk small. Lazy prune on claim (same as pruneExpiredMagicJti).

import { Prisma } from "@prisma/client";
import { db } from "./db";

/** How long we remember an update_id. Longer than any Telegram retry window. */
export const TELEGRAM_UPDATE_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ClaimUpdateResult = "claimed" | "already_seen" | "error";

/**
 * Atomically claim update_id for processing.
 *  • "claimed"      — first delivery; caller must process the update
 *  • "already_seen" — replay; caller must no-op domain side-effects
 *  • "error"        — DB failure; caller decides (webhook still returns 200)
 */
export async function claimTelegramUpdateId(
  updateId: number,
  now: Date = new Date(),
): Promise<ClaimUpdateResult> {
  if (!Number.isFinite(updateId)) return "error";
  const id = String(Math.trunc(updateId));
  const expiresAt = new Date(now.getTime() + TELEGRAM_UPDATE_RECEIPT_TTL_MS);
  try {
    await db.telegramWebhookReceipt.create({
      data: { updateId: id, expiresAt },
    });
    // Best-effort prune — never blocks claim success.
    void pruneExpiredTelegramUpdateReceipts(now);
    return "claimed";
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return "already_seen";
    }
    console.error("[telegram-update-receipt] claimTelegramUpdateId xatosi:", e);
    return "error";
  }
}

/**
 * Delete only expired receipt rows. Safe to call often (lazy from claim).
 * Returns deleted count; never throws.
 */
export async function pruneExpiredTelegramUpdateReceipts(
  now: Date = new Date(),
): Promise<number> {
  try {
    const res = await db.telegramWebhookReceipt.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return res.count;
  } catch (e) {
    console.error(
      "[telegram-update-receipt] pruneExpiredTelegramUpdateReceipts xatosi:",
      e,
    );
    return 0;
  }
}
