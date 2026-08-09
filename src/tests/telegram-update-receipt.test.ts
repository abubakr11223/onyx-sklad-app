// W9-D — TelegramWebhookReceipt claim (update_id at-most-once). No real DB.
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const store = new Set<string>();
  const create = vi.fn(
    async (args: { data: { updateId: string; expiresAt: Date } }) => {
      if (store.has(args.data.updateId)) {
        const { Prisma } = await import("@prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("dup updateId", {
          code: "P2002",
          clientVersion: "n/a",
        });
      }
      store.add(args.data.updateId);
      return args.data;
    },
  );
  const deleteMany = vi.fn(
    async (_args?: {
      where?: { updateId?: string; expiresAt?: { lt: Date } };
    }): Promise<{ count: number }> => ({ count: 0 }),
  );
  return { store, create, deleteMany };
});

vi.mock("@/lib/db", () => ({
  db: {
    telegramWebhookReceipt: {
      create: M.create,
      deleteMany: M.deleteMany,
    },
  },
}));

import {
  TELEGRAM_UPDATE_RECEIPT_TTL_MS,
  claimTelegramUpdateId,
  pruneExpiredTelegramUpdateReceipts,
  releaseTelegramUpdateId,
} from "@/lib/telegram-update-receipt";

beforeEach(() => {
  M.store.clear();
  M.create.mockClear();
  M.deleteMany.mockClear();
  M.deleteMany.mockImplementation(
    async (args?: {
      where?: { updateId?: string; expiresAt?: { lt: Date } };
    }) => {
      if (args?.where?.updateId) {
        const had = M.store.delete(args.where.updateId);
        return { count: had ? 1 : 0 };
      }
      return { count: 0 };
    },
  );
});

const NOW = new Date("2026-07-31T12:00:00Z");

describe("claimTelegramUpdateId", () => {
  it("first claim → claimed; same update_id again → already_seen", async () => {
    expect(await claimTelegramUpdateId(42, NOW)).toBe("claimed");
    expect(await claimTelegramUpdateId(42, NOW)).toBe("already_seen");
    expect(M.create).toHaveBeenCalledTimes(2);
    expect(M.create.mock.calls[0][0].data.updateId).toBe("42");
    const exp = M.create.mock.calls[0][0].data.expiresAt as Date;
    expect(exp.getTime() - NOW.getTime()).toBe(TELEGRAM_UPDATE_RECEIPT_TTL_MS);
  });

  it("different update_ids claim independently", async () => {
    expect(await claimTelegramUpdateId(1, NOW)).toBe("claimed");
    expect(await claimTelegramUpdateId(2, NOW)).toBe("claimed");
    expect(await claimTelegramUpdateId(1, NOW)).toBe("already_seen");
  });

  it("non-P2002 DB error → error (does not throw)", async () => {
    M.create.mockRejectedValueOnce(new Error("db down"));
    expect(await claimTelegramUpdateId(9, NOW)).toBe("error");
  });

  it("non-finite update_id → error", async () => {
    expect(await claimTelegramUpdateId(Number.NaN, NOW)).toBe("error");
  });
});

describe("pruneExpiredTelegramUpdateReceipts", () => {
  it("deletes only expiresAt < now", async () => {
    M.deleteMany.mockImplementationOnce(async () => ({ count: 0 }));
    await pruneExpiredTelegramUpdateReceipts(NOW);
    expect(M.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });
});

describe("releaseTelegramUpdateId — W10-B domain-fail recovery", () => {
  it("claim then release → same update_id can claim again", async () => {
    expect(await claimTelegramUpdateId(99, NOW)).toBe("claimed");
    expect(await claimTelegramUpdateId(99, NOW)).toBe("already_seen");
    expect(await releaseTelegramUpdateId(99)).toBe(true);
    expect(await claimTelegramUpdateId(99, NOW)).toBe("claimed");
  });

  it("release unknown id → false, no throw", async () => {
    expect(await releaseTelegramUpdateId(404)).toBe(false);
  });
});
