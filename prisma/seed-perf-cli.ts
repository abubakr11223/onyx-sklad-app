// W1-A — KATTA HAJMLI perf-seed CLI («Поиск камня» tezligini o'lchash uchun).
//
// uz: `seed:demo`dan farqi — bu ADDITIV va PARAMETRLI generator: 1000 tur /
//     50 000 plita / 10 000 boy darajasigacha ma'lumot yaratadi, shunda indeks
//     foydasini haqiqatan o'lchash mumkin bo'ladi. seed-demo.ts / seed.ts GA TEGMAYDI.
// ru: В отличие от seed:demo — аддитивный параметризуемый генератор больших
//     объёмов для замера скорости поиска. Демо-сид не трогает.
//
//   Yaratish:  npm run seed:perf -- --yes
//              npm run seed:perf -- --yes --types=1000 --slabs=50000 --pieces=10000
//   O'chirish: npm run seed:perf -- --purge --yes
//
// ⛔ HIMOYA: `--yes` (yoki SEED_PERF_CONFIRM=yes) bo'lmasa HECH NARSA qilinmaydi.
//    DATABASE_URL ko'pincha LIVE Neon bazasiga qaraydi — ishga tushirishdan oldin
//    qayerga ulanayotganingizni tekshiring. Yaratilgan har bir qator id'si
//    "perf-" bilan boshlanadi, shuning uchun --purge faqat o'shalarni o'chiradi.
import { PrismaClient } from "@prisma/client";
import {
  deletePerfData,
  parsePerfArgs,
  seedPerfData,
  usageText,
  validatePerfArgs,
} from "../src/lib/seed-perf";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const raw = parsePerfArgs(process.argv.slice(2));
  const parsed = validatePerfArgs(raw);

  if (!parsed.ok) {
    if (parsed.error === "confirm") {
      console.error(
        "⛔ Tasdiq yo'q: --yes (yoki SEED_PERF_CONFIRM=yes) berilmagan. Hech narsa qilinmadi.\n",
      );
    } else if (parsed.error === "number") {
      console.error("Son argumenti butun son bo'lishi kerak.\n");
    } else {
      console.error("Son argumenti ruxsat etilgan oralikdan tashqarida.\n");
    }
    console.error(usageText());
    process.exitCode = 1;
    return;
  }

  const log = (msg: string) => console.log(msg);

  if (parsed.purge) {
    console.log("Perf-ma'lumot o'chirilmoqda (id startsWith \"perf-\")…");
    const result = await deletePerfData(prisma, log);
    console.log("Perf purge OK:", result);
    return;
  }

  const result = await seedPerfData(prisma, parsed.scale, log);
  console.log("Perf seed OK:", result);
  console.log(
    "O'chirish uchun: npm run seed:perf -- --purge --yes",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
