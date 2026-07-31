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
function makeFakeDb(opts?: {
  /** Users already holding a telegramId (for W9-A steal-guard tests). */
  holders?: Array<{ id: string; role: string; name: string; telegramId: string }>;
}) {
  const created: Array<{ role: string; name: string; telegramId?: string | null }> =
    [];
  const holders = [...(opts?.holders ?? [])];
  let clearedOwner = false;
  const db = {
    user: {
      findFirst: async () => null,
      findMany: async ({
        where,
      }: {
        where?: { telegramId?: string };
      }) => {
        if (where?.telegramId) {
          return holders.filter((h) => h.telegramId === where.telegramId);
        }
        return holders;
      },
      create: async ({
        data,
      }: {
        data: { role: string; name: string; telegramId?: string | null };
      }) => {
        created.push({
          role: data.role,
          name: data.name,
          telegramId: data.telegramId ?? null,
        });
        return {
          id: `${data.role}-id`,
          role: data.role,
          name: data.name,
          telegramId: data.telegramId ?? null,
          passwordHash: null,
          email: null,
        };
      },
      update: async ({
        data,
      }: {
        data: { telegramId?: string | null; isActive?: boolean };
      }) => ({
        id: "WAREHOUSE-id",
        role: "WAREHOUSE",
        name: "Бахтиёр (демо)",
        telegramId: data.telegramId ?? null,
      }),
      updateMany: async ({
        where,
      }: {
        where?: { telegramId?: string; role?: { notIn?: string[] } };
      }) => {
        // Track if someone tried to clear OWNER's telegram.
        if (where?.telegramId) {
          const hit = holders.find((h) => h.telegramId === where.telegramId);
          if (hit?.role === "OWNER" && !where.role?.notIn?.includes("OWNER")) {
            clearedOwner = true;
          }
        }
        return { count: 0 };
      },
    },
    stoneType: {
      count: async () => 2, // >0 → блок создания камней пропускается
      create: async () => ({ id: "st" }),
    },
    batch: { count: async () => 1 },
  };
  return {
    db: db as unknown as PrismaClient,
    created,
    get clearedOwner() {
      return clearedOwner;
    },
  };
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
        ? {
            id: "existing-owner",
            role: "OWNER",
            name: "Владелец",
            telegramId: null,
            passwordHash: "x",
            email: "owner@onyx.local",
          }
        : null;

    const result = await seedDemoData(db, { warehouseTelegramId: null });

    expect(result.ownerId).toBe("existing-owner");
    expect(created.some((u) => u.role === "OWNER")).toBe(false);
  });
});

describe("seedDemoData — W9-A telegram steal guard", () => {
  it("does NOT assign DEMO_WAREHOUSE_TELEGRAM_ID when it is already on OWNER", async () => {
    const ownerTg = "999888777";
    const { db, created, clearedOwner } = makeFakeDb({
      holders: [
        {
          id: "owner-1",
          role: "OWNER",
          name: "Владелец",
          telegramId: ownerTg,
        },
      ],
    });

    const result = await seedDemoData(db, {
      warehouseTelegramId: ownerTg,
    });

    // Demo warehouse created without the owner's TG id.
    const wh = created.find((c) => c.role === "WAREHOUSE");
    expect(wh).toBeDefined();
    expect(wh?.telegramId).toBeNull();
    expect(result.warehouseTelegramId).toBeNull();
    // Must not clear OWNER's telegram via unprotected updateMany.
    expect(clearedOwner).toBe(false);
  });

  it("still assigns free telegramId to demo warehouse when not on OWNER/MANAGER", async () => {
    const { db, created } = makeFakeDb();
    const result = await seedDemoData(db, {
      warehouseTelegramId: "111222333",
    });
    const wh = created.find((c) => c.role === "WAREHOUSE");
    expect(wh?.telegramId).toBe("111222333");
    expect(result.warehouseTelegramId).toBe("111222333");
  });
});
