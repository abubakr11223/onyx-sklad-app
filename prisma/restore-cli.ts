// Zaxiradan tiklash — CLI. Sof mantiq src/lib/restore.ts da (unit-testlangan),
// bu yerda faqat fayl o'qish, DB yozish va ekranga chiqarish.
//
//   Quruq yurgizish:
//     ONYX_RESTORE_ALLOW=I_UNDERSTAND_WRITE npm run restore -- --file=zaxira.json
//   Haqiqiy tiklash:
//     ONYX_RESTORE_ALLOW=I_UNDERSTAND_WRITE npm run restore -- --file=zaxira.json --execute --yes
//
// Xavfsizlik: mavjud id'lar `skipDuplicates` bilan o'tkazib yuboriladi — ya'ni
// tiklash BOR ma'lumotni ustidan yozmaydi va takror yurgizilsa ikkilantirmaydi.
// Bo'sh bazaga to'liq tiklash uchun ham, yo'qolgan yozuvlarni to'ldirish uchun
// ham shu buyruq ishlaydi.
//
// DATABASE_URL — odatdagidek muhitdan. Ulanish faqat darvozalar o'tgach ochiladi.

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { BackupKeyError, resolveBackupKey, unpackBackup } from "../src/lib/backup-file";
import {
  DEFERRED_FIELDS,
  GENERATED_COLUMNS_SQL,
  RESTORE_ALLOW_ENV,
  RESTORE_ALLOW_VALUE,
  RESTORE_ORDER,
  buildGeneratedColumnMap,
  formatRestorePlan,
  parseRestoreArgs,
  parseSnapshotJson,
  planRestore,
  restoreUsage,
  splitDeferred,
  stripGeneratedColumns,
  validateRestoreArgs,
  type GeneratedColumnRow,
} from "../src/lib/restore";

/** Bir martada yuboriladigan yozuvlar soni — katta zaxirada so'rov cheklovi. */
const CHUNK = 500;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const raw = parseRestoreArgs(process.argv.slice(2), process.env);
  const parsed = validateRestoreArgs(raw);

  if (!parsed.ok) {
    if (parsed.error === "env") {
      console.error(
        `⛔ To'xtatildi: ${RESTORE_ALLOW_ENV}=${RESTORE_ALLOW_VALUE} bering.\n`,
      );
    } else if (parsed.error === "file") {
      console.error("⛔ --file=<zaxira.json> ko'rsatilmadi.\n");
    } else {
      console.error("⛔ --execute bilan birga --yes ham kerak.\n");
    }
    console.error(restoreUsage());
    process.exitCode = 1;
    return;
  }

  // Fayl uch shaklda bo'lishi mumkin: eski `.json`, siqilgan `.json.gz` va
  // shifrlangan `.json.gz.enc`. Shakl KENGAYTMA bo'yicha emas, faylning bosh
  // baytlari bo'yicha aniqlanadi — nomi o'zgartirilgan fayl ham ochiladi.
  let text: string;
  try {
    text = unpackBackup(readFileSync(parsed.file), resolveBackupKey());
  } catch (e) {
    if (e instanceof BackupKeyError) {
      console.error(`⛔ ${e.message}`);
    } else {
      console.error(`⛔ Fayl o'qilmadi: ${(e as Error).message}`);
    }
    process.exitCode = 1;
    return;
  }

  const snap = parseSnapshotJson(text);
  if (!snap.ok) {
    console.error(`⛔ Zaxira fayli yaroqsiz: ${snap.error}`);
    process.exitCode = 1;
    return;
  }

  const plan = planRestore(snap.snapshot);
  console.log(formatRestorePlan(plan));
  console.log("");

  if (!parsed.willWrite) {
    console.log("QURUQ YURGIZISH — bazaga hech narsa yozilmadi.");
    console.log("Tiklash uchun: --execute --yes qo'shing.");
    return;
  }

  const db = new PrismaClient();
  const written: Record<string, number> = {};
  const overwritten: Record<string, number> = {};
  let updated = 0;
  const pendingUpdates: { table: string; id: string; data: Record<string, unknown> }[] = [];

  try {
    // 0-bosqich: GENERATED ustunlar (Piece.boundingAreaMm2 va h.k.) —
    // Postgres ularga ochiq qiymat qabul QILMAYDI, DB o'zi hisoblaydi.
    // Ro'yxat sxemadan ish paytida olinadi — nom qattiq yozilmagan.
    const genRows = await db.$queryRawUnsafe<GeneratedColumnRow[]>(
      GENERATED_COLUMNS_SQL,
    );
    const generated = buildGeneratedColumnMap(genRows);
    for (const [t, cols] of Object.entries(generated)) {
      console.log(`  ${t}: generated ustun(lar) tashlab ketiladi — ${cols.join(", ")} (DB o'zi hisoblaydi)`);
    }

    // 1-bosqich: otadan bolaga. Halqali ustunlar null bilan qo'yiladi.
    // (overwritten — --overwrite rejimida ustidan yozilganlar sanog'i.)
    for (const table of RESTORE_ORDER) {
      const rows = snap.snapshot.rows[table] ?? [];
      if (rows.length === 0) continue;
      const { base: withGenerated, updates, skipped } = splitDeferred(table, rows);
      const base = stripGeneratedColumns(withGenerated, generated[table] ?? []);
      if (skipped > 0) {
        console.warn(
          `⚠️  ${table}: ${skipped} yozuvda id yo'q — bog'lam tiklanmaydi.`,
        );
      }
      for (const u of updates) pendingUpdates.push({ table, ...u });

      const delegate = (db as unknown as Record<string, {
        createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }>;
      }>)[table];
      let count = 0;
      for (const part of chunk(base, CHUNK)) {
        const r = await delegate.createMany({ data: part, skipDuplicates: true });
        count += r.count;
      }
      written[table] = count;

      // --overwrite: createMany faqat YANGI id'larni yozadi. Buzib kirilgan
      // bazada esa yozuvlar joyida turib, ICHI o'zgartirilgan bo'ladi — ular
      // shu yerda fayldagi holatga qaytariladi. Bittalab, chunki har yozuvda
      // o'z qiymatlari bor; bu falokat yo'li, tezlik ikkinchi darajali.
      if (parsed.overwrite && base.length > count) {
        const upd = (db as unknown as Record<string, {
          update: (a: { where: { id: string }; data: unknown }) => Promise<unknown>;
        }>)[table];
        let over = 0;
        let failed = 0;
        for (const row of base) {
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : null;
          if (id === null) continue;
          const { id: _drop, ...data } = r;
          void _drop;
          try {
            await upd.update({ where: { id }, data });
            over += 1;
          } catch {
            // Yozuv bazada yo'q (endigina createMany bilan yozilgan) yoki
            // cheklovga urildi — ikkalasi ham kutilgan, sanab o'tamiz.
            failed += 1;
          }
        }
        overwritten[table] = over;
        console.log(`  ${table.padEnd(24)} ~${over} ustidan yozildi${failed > 0 ? ` (${failed} o'tkazildi)` : ""}`);
      }
    }

    // 2-bosqich: halqani yopish (Slab.photoRequestId va h.k.).
    for (const u of pendingUpdates) {
      const delegate = (db as unknown as Record<string, {
        update: (a: { where: { id: string }; data: unknown }) => Promise<unknown>;
      }>)[u.table];
      try {
        await delegate.update({ where: { id: u.id }, data: u.data });
        updated += 1;
      } catch (e) {
        console.warn(`⚠️  ${u.table}/${u.id} bog'lami tiklanmadi: ${(e as Error).message}`);
      }
    }
  } finally {
    await db.$disconnect();
  }

  const total = Object.values(written).reduce((a, b) => a + b, 0);
  const over = Object.values(overwritten).reduce((a, b) => a + b, 0);
  console.log("");
  console.log(`✅ Tiklandi: ${total} yangi yozuv, ${updated} bog'lam (${Object.keys(DEFERRED_FIELDS).join(", ")}).`);
  if (parsed.overwrite) {
    console.log(`♻️  Ustidan yozildi: ${over} mavjud yozuv (--overwrite).`);
  } else {
    console.log("Mavjud id'lar o'tkazib yuborildi — bor ma'lumot ustiga yozilmadi.");
    console.log("Agar bazani BUZISHGAN bo'lsa, bu yetmaydi — docs/zaxira.md ga qarang.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
