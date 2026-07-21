// TZ №2 Faza A / OWN-01 — DEMO seed теперь создаёт root-аккаунт Владельца.
// Без БД: подставляем лёгкий in-memory мок PrismaClient и проверяем, что
// seedDemoData создаёт OWNER (когда его нет) и возвращает ownerId.
// Нормативный источник: OWN-01 (панель владельца пуста, т.к. в базе нет OWNER).
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedDemoData } from "@/lib/seed-demo";

/**
 * Минимальный фейк Prisma: фиксирует user.create по ролям и отдаёт предсказуемые
 * id. stoneType.count > 0 → создание камней пропускается (нам важен только путь
 * пользователей). findFirst всегда null → «ничего нет», seed создаёт всех с нуля.
 */
function makeFakeDb() {
  const created: Array<{ role: string; name: string }> = [];
  const db = {
    user: {
      findFirst: async () => null,
      create: async ({ data }: { data: { role: string; name: string; telegramId?: string | null } }) => {
        created.push({ role: data.role, name: data.name });
        return {
          id: `${data.role}-id`,
          role: data.role,
          name: data.name,
          telegramId: data.telegramId ?? null,
        };
      },
      update: async () => ({ id: "unused", telegramId: null }),
      updateMany: async () => ({ count: 0 }),
    },
    stoneType: {
      count: async () => 2, // >0 → блок создания камней пропускается
      create: async () => ({ id: "st" }),
    },
    batch: { count: async () => 1 },
  };
  return { db: db as unknown as PrismaClient, created };
}

describe("seedDemoData — OWNER root-аккаунт (OWN-01)", () => {
  it("создаёт OWNER и возвращает ownerId, когда владельца в базе нет", async () => {
    const { db, created } = makeFakeDb();

    const result = await seedDemoData(db, { warehouseTelegramId: null });

    // Владелец создан.
    expect(created.some((u) => u.role === "OWNER")).toBe(true);
    // ownerId присутствует в результате и указывает на созданного OWNER.
    expect(result.ownerId).toBe("OWNER-id");
    // Прежний контракт не сломан: менеджер и складчик тоже созданы/возвращены.
    expect(result.managerId).toBe("MANAGER-id");
    expect(result.warehouseId).toBe("WAREHOUSE-id");
  });

  it("не создаёт второго OWNER, если владелец уже есть (идемпотентность)", async () => {
    const { db, created } = makeFakeDb();
    // Переопределяем findFirst: для OWNER возвращаем существующего.
    (db as unknown as {
      user: { findFirst: (a: { where: { role: string } }) => Promise<unknown> };
    }).user.findFirst = async ({ where }) =>
      where.role === "OWNER"
        ? { id: "existing-owner", role: "OWNER", name: "Владелец", telegramId: null }
        : null;

    const result = await seedDemoData(db, { warehouseTelegramId: null });

    expect(result.ownerId).toBe("existing-owner");
    expect(created.some((u) => u.role === "OWNER")).toBe(false);
  });
});
