// Bir martalik DEMO/test ma'lumot — Telegram fotozapros oqimini prod'da sinash
// uchun (prod Neon bazasi bo'sh). IDEMPOTENT: qayta chaqirsa dublikat yaratmaydi.
// BU REAL OMBOR MA'LUMOTI EMAS — test uchun. Endpoint testdan keyin o'chiriladi.
import type { PrismaClient } from "@prisma/client";

export interface SeedDemoResult {
  ownerId: string;
  managerId: string;
  warehouseId: string;
  warehouseTelegramId: string | null;
  stoneTypes: number;
  batches: number;
}

export async function seedDemoData(
  db: PrismaClient,
  opts: { warehouseTelegramId?: string | null },
): Promise<SeedDemoResult> {
  const tgId = opts.warehouseTelegramId?.trim() || null;

  // ── 0) Владелец (OWNER) — root-akkaunt (bo'lmasa yaratamiz) ──
  // TZ №2 Faza A / OWN-01: bazada OWNER user bo'lmasa, demo-role=OWNER →
  // getCurrentUser null → PARTNER fallback → panel bo'sh. Shu yerda OWNER
  // yozuvini kafolatlaymiz (idempotent), shunda «Владелец» to'liq huquqli kiradi.
  let owner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) {
    owner = await db.user.create({
      data: {
        name: "Владелец (демо)",
        role: "OWNER",
        phone: "+998900000000",
        isActive: true,
      },
    });
  }

  // ── 1) Menejer (bo'lmasa yaratamiz) ──
  let manager = await db.user.findFirst({ where: { role: "MANAGER" } });
  if (!manager) {
    manager = await db.user.create({
      data: { name: "Дилшод (демо)", role: "MANAGER", phone: "+998900000001" },
    });
  }

  // ── 2) Skladchik — telegramId bilan (dispatch shunga boradi) ──
  // telegramId @unique: agar bu id boshqa yozuvda bo'lsa — avval bo'shatamiz.
  if (tgId) {
    await db.user.updateMany({ where: { telegramId: tgId }, data: { telegramId: null } });
  }
  let warehouse = await db.user.findFirst({ where: { role: "WAREHOUSE" } });
  if (warehouse) {
    warehouse = await db.user.update({
      where: { id: warehouse.id },
      data: { telegramId: tgId ?? warehouse.telegramId, isActive: true },
    });
  } else {
    warehouse = await db.user.create({
      data: {
        name: "Бахтиёр (демо)",
        role: "WAREHOUSE",
        phone: "+998900000002",
        telegramId: tgId,
      },
    });
  }

  // ── 3) Tosh + partiya + lokatsiya (faqat bazada tosh yo'q bo'lsa) ──
  const stoneCount = await db.stoneType.count();
  if (stoneCount === 0) {
    await db.stoneType.create({
      data: {
        name: "Травертин Classic (демо)",
        rockType: "травертин",
        color: "бежевый",
        basePrice: "95.00",
        purchasePrice: "60.00", // §5.8: маржа видна только OWNER (демо-данные)
        qrSlug: "demo-travertin",
        batches: {
          create: [
            {
              arrivedAt: new Date("2026-06-10T09:00:00Z"),
              supplierNote: "Демо-партия",
              slabsTotal: 40,
              areaTotalM2: "220.000",
              locations: {
                create: [
                  { block: "А", landmark: "2", slabsHere: 25, areaHereM2: "137.500" },
                  { block: "Б", landmark: "1–2", slabsHere: 15, areaHereM2: "82.500" },
                ],
              },
            },
          ],
        },
      },
    });
    await db.stoneType.create({
      data: {
        name: "Оникс Медовый (демо)",
        rockType: "оникс",
        color: "медовый",
        basePrice: "310.00",
        purchasePrice: "210.00", // §5.8: маржа видна только OWNER (демо-данные)
        qrSlug: "demo-onyx",
        batches: {
          create: [
            {
              arrivedAt: new Date("2026-06-25T14:00:00Z"),
              slabsTotal: 12,
              areaTotalM2: "60.000",
              locations: {
                create: [{ block: "В", landmark: "3", slabsHere: 12, areaHereM2: "60.000" }],
              },
            },
          ],
        },
      },
    });
  }

  return {
    ownerId: owner.id,
    managerId: manager.id,
    warehouseId: warehouse.id,
    warehouseTelegramId: warehouse.telegramId,
    stoneTypes: await db.stoneType.count(),
    batches: await db.batch.count(),
  };
}
