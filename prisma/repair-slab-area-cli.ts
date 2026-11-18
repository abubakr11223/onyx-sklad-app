// ТЗ №21 А1 — пересчёт площади у старых продаж плитами.
//
// uz: Plita bilan sotilgan, lekin m² kamaymagan eski sotuvlarni tuzatadi.
// ru: Продажи плитами, у которых площадь не списалась, получают площадь
//     N × площадь плиты; счётчики узора и партии уменьшают остаток м².
//
//   Проверка (ничего не пишет):   npm run repair:slab-area
//   Запись:                       npm run repair:slab-area -- --apply --yes
//
// ⛔ DATABASE_URL может указывать на боевую базу. Сначала проверка, потом
//    резервная копия, потом запись. Повторный запуск безопасен: исправленные
//    продажи уже имеют площадь и в план не попадают.

import { PrismaClient } from "@prisma/client";
import { patternUnitAreaM2 } from "../src/lib/pattern-stock";
import { formatRepairPlan, planSlabAreaRepair, type RepairSaleRow } from "../src/lib/slab-area-repair";

const num = (d: { toString(): string } | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d.toString());

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  if (apply && !args.has("--yes")) {
    console.error("Для записи нужны оба флага: --apply --yes");
    process.exit(2);
  }
  const db = new PrismaClient();
  try {
    const sales = await db.saleRecord.findMany({
      where: { targetType: "BATCH_VOLUME", qtySlabs: { gt: 0 }, qtyAreaM2: null, batchId: { not: null } },
      orderBy: { soldAt: "asc" },
      select: {
        id: true,
        soldAt: true,
        qtySlabs: true,
        returnedSlabs: true,
        batchId: true,
        batchPatternId: true,
        batch: {
          select: {
            slabsTotal: true,
            areaTotalM2: true,
            lengthMm: true,
            widthMm: true,
            stoneType: { select: { name: true } },
          },
        },
        batchPattern: {
          select: {
            description: true,
            slabsCount: true,
            areaM2: true,
            slabsSold: true,
            areaSoldM2: true,
            lengthMm: true,
            widthMm: true,
          },
        },
      },
    });
    const rows: RepairSaleRow[] = [];
    for (const s of sales) {
      if (!s.batch || !s.batchId) continue;
      if (s.batch.areaTotalM2 === null && !s.batchPattern) continue; // учёт м² выключен
      const unit = s.batchPattern
        ? patternUnitAreaM2({
            slabsCount: s.batchPattern.slabsCount,
            areaM2: num(s.batchPattern.areaM2),
            slabsSold: s.batchPattern.slabsSold,
            areaSoldM2: num(s.batchPattern.areaSoldM2),
            lengthMm: s.batchPattern.lengthMm,
            widthMm: s.batchPattern.widthMm,
          })
        : s.batch.lengthMm && s.batch.widthMm
          ? (s.batch.lengthMm * s.batch.widthMm) / 10_000
          : s.batch.slabsTotal && s.batch.areaTotalM2
            ? num(s.batch.areaTotalM2) / s.batch.slabsTotal
            : 0;
      rows.push({
        id: s.id,
        soldAt: s.soldAt,
        qtySlabs: s.qtySlabs ?? 0,
        returnedSlabs: s.returnedSlabs,
        batchId: s.batchId,
        batchPatternId: s.batchPatternId,
        unitAreaM2: unit,
        label:
          `${s.batch.stoneType?.name ?? "Камень"}` +
          (s.batchPattern?.description ? ` · узор «${s.batchPattern.description}»` : "") +
          ` · ${s.qtySlabs} пл.`,
      });
    }
    const plan = planSlabAreaRepair(rows);
    console.log(formatRepairPlan(plan));
    if (!apply) {
      console.log("\nПроверка: в базу ничего не записано. Для записи: --apply --yes");
      return;
    }
    for (const p of plan) {
      await db.$transaction(async (tx) => {
        const res = await tx.saleRecord.updateMany({
          where: { id: p.saleId, qtyAreaM2: null },
          data: {
            qtyAreaM2: p.saleAreaM2.toFixed(3),
            returnedAreaM2: p.returnedAreaM2.toFixed(3),
          },
        });
        if (res.count === 0) return; // уже исправлена параллельно
        if (p.addSoldAreaM2 > 0) {
          await tx.batch.update({
            where: { id: p.batchId },
            data: { areaSoldDirectM2: { increment: p.addSoldAreaM2.toFixed(3) } },
          });
          if (p.batchPatternId) {
            await tx.batchPattern.update({
              where: { id: p.batchPatternId },
              data: { areaSoldM2: { increment: p.addSoldAreaM2.toFixed(3) } },
            });
          }
        }
      });
    }
    console.log(`\nЗаписано: ${plan.length} продаж.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
