// Onyx — dev seed (S1-C). `prisma migrate reset` dan keyin toza bazaga yoziladi,
// shuning uchun oddiy create'lar yetarli. Ma'lumotlar docs/data-model.md §3
// hisob invariantiga mos: partiya slabsTotal ajratilgan plitalar/boylarni qoplaydi.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  // ── Foydalanuvchilar: har rol uchun bittadan (TZ §3) ──
  const owner = await prisma.user.create({
    data: {
      name: "Рустам Каримов",
      role: "OWNER",
      phone: "+998901112233",
      telegramId: "100001",
      canSeePurchasePrice: true, // Owner uchun baribir e'tiborga olinmaydi — doim ko'radi
    },
  });
  const manager = await prisma.user.create({
    data: {
      name: "Дилшод Ахмедов",
      role: "MANAGER",
      phone: "+998902223344",
      telegramId: "100002",
      canSeePurchasePrice: false,
    },
  });
  const warehouse = await prisma.user.create({
    data: {
      name: "Бахтиёр Юлдашев",
      role: "WAREHOUSE",
      phone: "+998903334455",
      telegramId: "100003",
    },
  });
  await prisma.user.create({
    data: {
      name: "Анна Соколова (дизайнер)",
      role: "PARTNER",
      phone: "+998904445566",
      email: "a.sokolova@example.com",
    },
  });

  // ── Toshning 5 vidi (L1 katalog) ──
  const travertin = await prisma.stoneType.create({
    data: {
      name: "Травертин Classic",
      rockType: "травертин",
      color: "бежевый",
      description: "Классический травертин, тёплый бежевый тон.",
      properties: { origin: "Турция", finish: "полированный" },
      basePrice: "95.00",
      purchasePrice: "58.00",
      qrSlug: "travertin-classic",
    },
  });
  const calacatta = await prisma.stoneType.create({
    data: {
      name: "Calacatta Gold",
      rockType: "мрамор",
      color: "белый с золотыми прожилками",
      description: "Итальянский мрамор Calacatta с золотистыми прожилками.",
      properties: { origin: "Италия", finish: "полированный" },
      basePrice: "420.00",
      purchasePrice: "260.00",
      qrSlug: "calacatta-gold",
    },
  });
  const onyxMed = await prisma.stoneType.create({
    data: {
      name: "Оникс Медовый",
      rockType: "оникс",
      color: "медовый",
      description: "Полупрозрачный оникс, подходит для подсветки.",
      basePrice: "310.00",
      purchasePrice: "190.00",
      qrSlug: "onyx-medovyj",
    },
  });
  await prisma.stoneType.create({
    data: {
      name: "Гранит Куру Грей",
      rockType: "гранит",
      color: "серый",
      description: "Финский серый гранит, высокая износостойкость.",
      basePrice: "120.00",
      purchasePrice: "72.00",
      qrSlug: "granit-kuru-grey",
    },
  });
  await prisma.stoneType.create({
    data: {
      name: "Мрамор Bianco Carrara",
      rockType: "мрамор",
      color: "белый",
      description: "Классический каррарский мрамор.",
      basePrice: "180.00",
      purchasePrice: "105.00",
      qrSlug: "bianco-carrara",
    },
  });

  // ── Partiyalar (L2). batch1 — IKKI lokatsiyada (TZ §4.5 — norma) ──
  const batch1 = await prisma.batch.create({
    data: {
      stoneTypeId: travertin.id,
      arrivedAt: new Date("2026-06-10T09:00:00Z"),
      supplierNote: "Контейнер MSKU-402871, инвойс TR-118",
      slabsTotal: 40,
      areaTotalM2: "220.000",
      purchasePrice: "12760.00",
      locations: {
        create: [
          { block: "А", landmark: "2", slabsHere: 25, areaHereM2: "137.500" },
          { block: "Б", landmark: "1–2", slabsHere: 15, areaHereM2: "82.500", note: "у дороги, штабель" },
        ],
      },
    },
  });
  const batch2 = await prisma.batch.create({
    data: {
      stoneTypeId: calacatta.id,
      arrivedAt: new Date("2026-06-18T11:30:00Z"),
      supplierNote: "Инвойс IT-2209, Carrara Trade S.p.A.",
      slabsTotal: 25,
      areaTotalM2: "130.000",
      purchasePrice: "33800.00",
      locations: {
        create: [{ block: "В", landmark: "3", slabsHere: 25, areaHereM2: "130.000" }],
      },
    },
  });
  await prisma.batch.create({
    data: {
      stoneTypeId: onyxMed.id,
      arrivedAt: new Date("2026-06-25T14:00:00Z"),
      supplierNote: "Иран, инвойс IR-77",
      slabsTotal: 12,
      areaTotalM2: "60.000",
      locations: {
        create: [{ block: "А", landmark: "4", slabsHere: 12, areaHereM2: "60.000" }],
      },
    },
  });

  // ── Ajratilgan plitalar (ADR-004: faqat kerak bo'lganda) ──
  // slab1 quyida faol bron oladi → statusi RESERVED (§2 o'tish №1 bilan izchil).
  const slab1 = await prisma.slab.create({
    data: {
      batchId: batch1.id,
      stoneTypeId: travertin.id,
      label: "Плита №1",
      status: "RESERVED",
      lengthMm: 2800,
      widthMm: 1900,
      thicknessMm: 20,
      areaM2: "5.320",
      isAreaEstimated: false,
      block: "А",
      landmark: "2",
      separatedById: warehouse.id,
    },
  });
  await prisma.slab.create({
    data: {
      batchId: batch2.id,
      stoneTypeId: calacatta.id,
      label: "Плита №1",
      status: "AVAILABLE",
      // o'lchamlar hali kiritilmagan — partiya o'rtachasi (130/25)
      areaM2: "5.200",
      isAreaEstimated: true,
      block: "В",
      landmark: "3",
      separatedById: warehouse.id,
    },
  });

  // ── Boy / qoldiq (poshtuchno, o'z gabaritlari bilan — TZ §4.2) ──
  await prisma.piece.create({
    data: {
      stoneTypeId: travertin.id,
      batchId: batch1.id, // partiyadan to'g'ridan-to'g'ri boy (originSlabId = null)
      kind: "BROKEN",
      sidesMm: [1180, 640, 950, 610],
      boundingLengthMm: 1180,
      boundingWidthMm: 640,
      thicknessMm: 20,
      areaM2: "0.600",
      block: "Б",
      landmark: "1–2",
      createdById: warehouse.id,
    },
  });
  await prisma.piece.create({
    data: {
      stoneTypeId: calacatta.id,
      batchId: batch2.id,
      kind: "OFFCUT",
      sidesMm: [1450, 800, 1450, 800],
      boundingLengthMm: 1450,
      boundingWidthMm: 800,
      thicknessMm: 20,
      areaM2: "1.160",
      block: "В",
      landmark: "3",
      createdById: warehouse.id,
    },
  });

  // ── Faol bron: slab1 → 3 kun (ADR-003) ──
  await prisma.reservation.create({
    data: {
      targetType: "SLAB",
      slabId: slab1.id,
      managerId: manager.id,
      customerName: "Иван Петров",
      customerContact: "+998971234567",
      expiresAt: new Date(Date.now() + 3 * DAY_MS),
      status: "ACTIVE",
    },
  });

  // ── Sozlamalar (ADR-003; data-model.md §1.11) ──
  await prisma.appConfig.createMany({
    data: [
      { key: "reservationDays", value: "3" },
      { key: "photoStaleMonths", value: "6" },
    ],
  });

  console.log("Seed OK:", {
    users: await prisma.user.count(),
    stoneTypes: await prisma.stoneType.count(),
    batches: await prisma.batch.count(),
    batchLocations: await prisma.batchLocation.count(),
    slabs: await prisma.slab.count(),
    pieces: await prisma.piece.count(),
    reservations: await prisma.reservation.count(),
    appConfig: await prisma.appConfig.count(),
    owner: owner.name,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
