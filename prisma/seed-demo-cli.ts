// Onyx — DEMO seed CLI (SK-4a).
// uz: Bu terminal-only runner o'chirilgan web-endpoint (/api/admin/seed) o'rnini
//     bosadi. Faqat ishonchli terminaldan ishga tushiriladi — web'ga ochilmagan.
//     Ishga tushirish: `npm run seed:demo`.
// ru: Этот терминальный запускатель заменяет удалённый веб-эндпоинт
//     (/api/admin/seed). Запускается только из доверенного терминала, не открыт в веб.
//     Запуск: `npm run seed:demo`.
//
// Skladchining Telegram id'sini DEMO_WAREHOUSE_TELEGRAM_ID env'dan oladi;
// bo'lmasa undefined uzatiladi (seedDemoData buni o'zi qayta ishlaydi).
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../src/lib/seed-demo";

const prisma = new PrismaClient();

async function main() {
  const warehouseTelegramId = process.env.DEMO_WAREHOUSE_TELEGRAM_ID || undefined;
  const result = await seedDemoData(prisma, { warehouseTelegramId });
  console.log("Demo seed OK:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
