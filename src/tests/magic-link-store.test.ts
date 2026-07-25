// Аудит ТЗ №7 #10 — single-use магик-линка через ConsumedMagicLinkToken.
// Мок-tx: имитируем UNIQUE @id — если jti уже «в базе», create → P2002.
// Также проверяем pruneExpiredMagicJti — фильтр WHERE именно `expiresAt: { lt: now }`.
// Real DB integration (Postgres UNIQUE) — см. magic-link-store.integration.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const store = new Set<string>();
  const create = vi.fn(async (args: { data: { jti: string; userId: string; expiresAt: Date } }) => {
    if (store.has(args.data.jti)) {
      // Имитируем поведение Prisma при нарушении UNIQUE @id.
      const { Prisma } = await import("@prisma/client");
      throw new Prisma.PrismaClientKnownRequestError("dup jti", {
        code: "P2002",
        clientVersion: "n/a",
      });
    }
    store.add(args.data.jti);
    return args.data;
  });
  const deleteMany = vi.fn(async (_args: { where: { expiresAt: { lt: Date } } }) => ({
    count: 0,
  }));
  return { store, create, deleteMany };
});

vi.mock("@/lib/db", () => ({
  db: {
    consumedMagicLinkToken: {
      create: M.create,
      deleteMany: M.deleteMany,
    },
  },
}));

// Импорт ПОСЛЕ мока.
import {
  consumeMagicLinkJti,
  pruneExpiredMagicJti,
} from "@/lib/magic-link-store";

beforeEach(() => {
  M.store.clear();
  M.create.mockClear();
  M.deleteMany.mockClear();
});

const NOW = new Date("2026-07-25T20:00:00Z");
const FUTURE = new Date("2026-07-25T20:02:00Z"); // +2 min
const PAST = new Date("2026-07-25T19:00:00Z");

// ═══════════════ (1) Одна и та же jti — второй заход → рад ═══════════════

describe("consumeMagicLinkJti — single-use через UNIQUE @id (ТЗ №7 #10)", () => {
  it("(1) первый заход с jti → «consumed»; второй заход с ТЕМ ЖЕ jti → «already_used»", async () => {
    const jti = "j-1";
    expect(await consumeMagicLinkJti(jti, "u1", FUTURE)).toBe("consumed");
    // Retry (тот же jti) — replay в пределах 2-min окна.
    expect(await consumeMagicLinkJti(jti, "u1", FUTURE)).toBe("already_used");
    // Ровно 2 попытки записи (обе долетели до create; UNIQUE отбил вторую).
    expect(M.create).toHaveBeenCalledTimes(2);
  });

  it("разные jti — независимо consumed (не мешают друг другу)", async () => {
    expect(await consumeMagicLinkJti("j-a", "u1", FUTURE)).toBe("consumed");
    expect(await consumeMagicLinkJti("j-b", "u1", FUTURE)).toBe("consumed");
    // Но replay каждого — по-прежнему deny.
    expect(await consumeMagicLinkJti("j-a", "u1", FUTURE)).toBe("already_used");
  });

  it("не-P2002 (например, БД недоступна) → «error» (fail-closed), НЕ throw'ает", async () => {
    M.create.mockRejectedValueOnce(new Error("db down"));
    expect(await consumeMagicLinkJti("j-x", "u1", FUTURE)).toBe("error");
  });
});

// ═══════════════ (2) Параллельные два запроса — только ОДИН consumed ═══════════════

describe("consumeMagicLinkJti — параллельные попытки (гонка Telegram forward, ТЗ №7 #10)", () => {
  it("(2) Promise.all([consume, consume]) с одним jti → ровно ОДИН 'consumed', второй — 'already_used'", async () => {
    const jti = "j-race";
    // Моки sync-детерминированные — оба create зайдут в одну очередь; первая
    // добавит в Set, вторая словит P2002 (мок реализует UNIQUE через Set).
    const [a, b] = await Promise.all([
      consumeMagicLinkJti(jti, "u1", FUTURE),
      consumeMagicLinkJti(jti, "u1", FUTURE),
    ]);
    const outcomes = [a, b].sort();
    expect(outcomes).toEqual(["already_used", "consumed"]);
  });
});

// ═══════════════ (3) pruneExpiredMagicJti — только expiresAt < now ═══════════════

describe("pruneExpiredMagicJti — WHERE фильтр (ТЗ №7 #10)", () => {
  it("(3) вызывает deleteMany с where.expiresAt.lt = now, ровно один раз", async () => {
    M.deleteMany.mockResolvedValueOnce({ count: 3 });
    const n = await pruneExpiredMagicJti(NOW);
    expect(n).toBe(3);
    expect(M.deleteMany).toHaveBeenCalledTimes(1);
    const where = M.deleteMany.mock.calls[0][0].where;
    // Именно `lt`, не `lte` — токен, срок которого совпадает с now, ещё жив.
    expect(where).toEqual({ expiresAt: { lt: NOW } });
  });

  it("БД упала → возвращает 0, НЕ throw'ает (login-поток не блокируется)", async () => {
    M.deleteMany.mockRejectedValueOnce(new Error("db down"));
    expect(await pruneExpiredMagicJti(NOW)).toBe(0);
  });

  it("санити: сам фильтр `lt: now` семантически отсеивает только прошлое (регрессия документируется)", () => {
    // Чистая проверка семантики: date < now у прошлого true, у будущего false, у равного false.
    expect(PAST < NOW).toBe(true);
    expect(FUTURE < NOW).toBe(false);
    expect(NOW < NOW).toBe(false);
  });
});
