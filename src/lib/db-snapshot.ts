// Kunlik ma'lumot zaxirasi (snapshot) — bazadagi HAMMA ish jadvalini bitta
// JSON'ga yig'adi.
//
// Nega kerak: baza xizmatining o'z tiklashi bazani TIKLAYDI, lekin u o'sha
// akkauntning ichida yashaydi va o'z serverga ko'chgan kuni yo'qoladi. Bu
// yerdagi snapshot esa bazadan TASHQARIDA saqlanadi. Bitta noto'g'ri purge
// yoki o'chirilgan proyekt — ma'lumot yo'qolishiga olib kelmasin.
//
// ⚠️ ROSTI (audit 2026-09-02). Bu izohda ilgari «Cowork jadvalli vazifasi
// nusxani Google Drive/Sheets'ga ko'chiradi» deb yozilgan edi. Bunday vazifa
// HECH QACHON bo'lmagan — izoh yo'q himoyani bor deb ko'rsatib turgan. Hozir
// zaxiraning yagona avtomatik manzili — Telegram. Ikkinchi nusxa QO'LDA
// sozlanadi va u docs/zaxira.md §2 da yozilgan.
//
// Nima kirmaydi: LoginAttempt, ConsumedMagicLinkToken, TelegramWebhookReceipt,
// MutationReceipt — bular xavfsizlik/idempotentlik izlari, tiklashda keraksiz
// va tez o'sadi.
//
// Photo — faqat METADATA: rasm baytlari bu faylda YO'Q. Ya'ni bazani tiklab
// rasmlarni tiklamasangiz, hamma surat ochilmaydigan havolaga aylanadi.
// Rasmlar alohida ko'chiriladi: `npm run backup:photos` (docs/zaxira.md §3).
// Bu ataylab shunday: rasmlar bilan birga fayl gigabaytlarga chiqib, kunlik
// zaxira umuman ishlamay qolardi.
//
// Fayl SHAKLI (siqish, shifrlash, parol xeshlarini olib tashlash) shu modulda
// EMAS — u src/lib/backup-file.ts da. Bu modul faqat MA'LUMOTNI yig'adi.
//
// Modul sof: PrismaClient interfeysining faqat findMany qismini kutadi, shuning
// uchun unit-testda soxta (fake) client bilan tekshiriladi — DATABASE_URL kerak
// emas (purge.ts bilan bir xil uslub).

/** Snapshot'ga kiradigan jadvallar — Prisma delegate nomlari (camelCase). */
export const SNAPSHOT_TABLES = [
  "appConfig",
  "user",
  "warehouseBlock",
  "warehouseLandmark",
  "kartaCell",
  "stoneType",
  "batch",
  "batchPattern",
  "batchLocation",
  "slab",
  "piece",
  "sample",
  "client",
  "site",
  "reservation",
  "showroomPlacement",
  "saleRecord",
  "shipment",
  "shipmentLine",
  "debt",
  "lead",
  "photoRequest",
  "photoDispatch",
  "photo",
  "telegramAccessRequest",
  "auditLog",
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/** Snapshot'ga ATAYLAB kirmaydigan jadvallar (test shu ro'yxatga qaraydi). */
export const SNAPSHOT_EXCLUDED = [
  "LoginAttempt",
  "ConsumedMagicLinkToken",
  "TelegramWebhookReceipt",
  "MutationReceipt",
] as const;

export interface Snapshot {
  /** Format versiyasi — tiklash skripti shunga qarab o'qiydi. */
  version: 1;
  /** ISO vaqt (chaqiruvchi beradi — modul ichida new Date() yo'q). */
  takenAt: string;
  /** Jadval → yozuvlar soni (tez ko'z tashlash uchun). */
  counts: Record<string, number>;
  /** Jadval → yozuvlar. */
  rows: Record<string, unknown[]>;
}

/** findMany qila oladigan minimal delegate (unit-testda soxta bilan almashadi). */
export interface SnapshotDelegate {
  findMany: (args?: unknown) => Promise<unknown[]>;
}

/**
 * Client `unknown` deb olinadi va ichkarida nomma-nom tekshiriladi. Sabab:
 * PrismaClient'ning generic `findMany` imzosi index-signature'li tipga
 * to'g'ridan-to'g'ri tushmaydi, testdagi soxta client esa tushadi. Zaxira
 * modulini Prisma tiplariga bog'lab qo'ymaslik uchun chegarani shu yerda
 * yumshatamiz — evaziga har jadval mavjudligi ish paytida tekshiriladi.
 */
export type SnapshotClient = unknown;

/**
 * Hamma jadvalni ketma-ket o'qiydi (parallel emas: Neon'ning pooler'ida
 * bir vaqtning o'zida 26 ta og'ir so'rov ochish — keraksiz zarba, zaxira esa
 * shoshilmaydi). Jadval client'da topilmasa — bo'sh massiv va 0, chunki
 * snapshot yarim yo'lda yiqilgandan ko'ra to'liqmas bo'lgani yaxshi.
 */
export async function buildSnapshot(
  client: SnapshotClient,
  takenAt: string,
): Promise<Snapshot> {
  const counts: Record<string, number> = {};
  const rows: Record<string, unknown[]> = {};

  const c = client as Record<string, Partial<SnapshotDelegate> | undefined>;
  for (const table of SNAPSHOT_TABLES) {
    const delegate = c[table];
    if (!delegate || typeof delegate.findMany !== "function") {
      counts[table] = 0;
      rows[table] = [];
      continue;
    }
    const data = await delegate.findMany();
    rows[table] = data;
    counts[table] = data.length;
  }

  return { version: 1, takenAt, counts, rows };
}

/**
 * JSON matn. Prisma Decimal `toJSON` orqali satrga aylanadi, Date — ISO'ga;
 * BigInt esa JSON.stringify'ni yiqitadi, shuning uchun uni qo'lda satrga
 * o'giramiz (hozir bunday ustun yo'q, lekin sxema o'sganda zaxira jim
 * yiqilmasligi kerak).
 */
export function snapshotToJson(snapshot: Snapshot): string {
  return JSON.stringify(snapshot, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/** `onyx-backup-2026-08-24.json` — sana bo'yicha saralanadigan nom. */
export function snapshotFilename(takenAtIso: string): string {
  const day = takenAtIso.slice(0, 10);
  return `onyx-backup-${day}.json`;
}

/** Jami yozuvlar soni — bo'sh zaxira ketib qolmaganini tekshirish uchun. */
export function snapshotTotalRows(snapshot: Snapshot): number {
  return Object.values(snapshot.counts).reduce((a, b) => a + b, 0);
}

/**
 * Telegram'ga ketadigan izoh: eng muhim jadvallar sanoq bilan. Hammasini
 * sanab ketmaymiz — nol bo'lganlari shovqin, ular JSON ichida bor.
 */
export function snapshotCaption(snapshot: Snapshot): string {
  const key: [string, string][] = [
    ["stoneType", "Виды камня"],
    ["batch", "Партии"],
    ["batchLocation", "Локации"],
    ["slab", "Плиты"],
    ["piece", "Куски"],
    ["saleRecord", "Продажи"],
    ["debt", "Долги"],
    ["client", "Клиенты"],
    ["user", "Аккаунты"],
  ];
  const lines = key
    .filter(([t]) => (snapshot.counts[t] ?? 0) > 0)
    .map(([t, ru]) => `${ru}: ${snapshot.counts[t]}`);
  return [
    `Onyx — резервная копия ${snapshot.takenAt.slice(0, 10)}`,
    ...lines,
    `Всего записей: ${snapshotTotalRows(snapshot)}`,
  ].join("\n");
}
