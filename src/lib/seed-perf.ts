// W1-A — KATTA HAJMLI perf-seed generatori («Поиск камня» tezligini o'lchash uchun).
//
// NEGA ALOHIDA FAYL: mavjud `seed:demo` (src/lib/seed-demo.ts) atigi 2 StoneType /
// 2 Batch / 0 Slab / 0 Piece yaratadi va bazada tosh bo'lsa umuman o'tkazib
// yuboradi (seed-demo.ts:91-92) — ya'ni u bilan indekslarning foydasini o'lchab
// bo'lmaydi. Bu modul ADDITIV va PARAMETRLI: seed-demo.ts / seed.ts GA TEGMAYDI.
//
// NOM MAKONI (namespace): yaratilgan HAR BIR qatorning `id`'si "perf-" bilan
// boshlanadi (cuid o'rniga aniq id beramiz). Shu sabab:
//   • o'chirish oddiy va aniq — `id startsWith "perf-"` (deletePerfData);
//   • qayta ishga tushirish xavfsiz — createMany + skipDuplicates;
//   • real ma'lumot bilan hech qachon chalkashmaydi.
// Ko'rinadigan nomlar ham belgilangan: StoneType.name "[perf] …" bilan boshlanadi.
//
// XAVFSIZLIK: hech narsa yozilmaydi, agar ANIQ rozilik berilmagan bo'lsa
// (`--yes` yoki SEED_PERF_CONFIRM=yes). Prod bazaga tasodifan yo'naltirishdan
// himoya (DATABASE_URL ko'pincha LIVE Neon'ga qaraydi).
//
// Bu fayldagi `buildPerfDataset` — SOF funksiya (DB'siz): butun to'plamni
// xotirada quradi, shuning uchun DB'ga ulanmasdan tekshirsa bo'ladi.
import type { Prisma, PrismaClient } from "@prisma/client";

/** Barcha yaratilgan qatorlar id'sining prefiksi — o'chirish kaliti. */
export const PERF_ID_PREFIX = "perf-";
/** StoneType.name'da ko'rinadigan belgi. */
export const PERF_NAME_PREFIX = "[perf]";

/** `createMany` uchun bitta so'rovdagi qatorlar soni. */
export const CHUNK_SIZE = 1000;

export interface PerfScale {
  types: number;
  slabs: number;
  pieces: number;
}

/** Brifdagi maqsad hajm. */
export const DEFAULT_SCALE: PerfScale = {
  types: 1000,
  slabs: 50_000,
  pieces: 10_000,
};

/** Cheklovlar — tasodifan 10 million qator yaratib qo'ymaslik uchun. */
export const MAX_SCALE: PerfScale = {
  types: 20_000,
  slabs: 500_000,
  pieces: 200_000,
};

// ───────────────────────────── argv / env tahlili ─────────────────────────────
// (uslub: prisma/seed-owner-cli.ts:25 → src/lib/seed-owner.ts parseOwnerArgs)

export interface RawPerfArgs {
  types: string | null;
  slabs: string | null;
  pieces: string | null;
  confirm: boolean;
  purge: boolean;
}

/**
 * `--types=` / `--slabs=` / `--pieces=` / `--yes` / `--purge` va
 * SEED_PERF_TYPES / SEED_PERF_SLABS / SEED_PERF_PIECES / SEED_PERF_CONFIRM
 * env'laridan xom qiymatlarni yig'adi. argv env'dan ustun. Yon ta'sirsiz.
 */
export function parsePerfArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RawPerfArgs {
  let types: string | null = null;
  let slabs: string | null = null;
  let pieces: string | null = null;
  let confirm = false;
  let purge = false;

  for (const arg of argv) {
    if (arg === "--yes") confirm = true;
    else if (arg === "--purge") purge = true;
    else if (arg.startsWith("--types=")) types = arg.slice("--types=".length);
    else if (arg.startsWith("--slabs=")) slabs = arg.slice("--slabs=".length);
    else if (arg.startsWith("--pieces=")) pieces = arg.slice("--pieces=".length);
  }

  if (types === null && env.SEED_PERF_TYPES) types = env.SEED_PERF_TYPES;
  if (slabs === null && env.SEED_PERF_SLABS) slabs = env.SEED_PERF_SLABS;
  if (pieces === null && env.SEED_PERF_PIECES) pieces = env.SEED_PERF_PIECES;
  if (!confirm && env.SEED_PERF_CONFIRM === "yes") confirm = true;

  return { types, slabs, pieces, confirm, purge };
}

export type PerfArgsResult =
  | { ok: true; scale: PerfScale; purge: boolean }
  | { ok: false; error: "confirm" | "number" | "range" };

/** Bitta son argumentini tahlil qiladi: musbat butun son yoki null (default). */
function parseCount(raw: string | null, fallback: number): number | null {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim()) return null;
  return n;
}

/**
 * Xom argsni tekshiradi. Xato kodlari:
 *   - "confirm" — ANIQ rozilik yo'q (`--yes` / SEED_PERF_CONFIRM=yes). ⛔ asosiy himoya.
 *   - "number"  — son argumenti butun son emas.
 *   - "range"   — son manfiy yoki MAX_SCALE'dan katta, yoki imkonsiz
 *                 kombinatsiya (types=1 + slabs/pieces>0 — pastda).
 */
export function validatePerfArgs(raw: RawPerfArgs): PerfArgsResult {
  // Rozilik BIRINCHI tekshiriladi — hajmdan qat'i nazar, u holda hech qachon
  // «tasodifan ishga tushdi» holati bo'lmaydi (o'chirish uchun ham shart).
  if (!raw.confirm) return { ok: false, error: "confirm" };

  const types = parseCount(raw.types, DEFAULT_SCALE.types);
  const slabs = parseCount(raw.slabs, DEFAULT_SCALE.slabs);
  const pieces = parseCount(raw.pieces, DEFAULT_SCALE.pieces);
  if (types === null || slabs === null || pieces === null) {
    return { ok: false, error: "number" };
  }

  if (types < 0 || slabs < 0 || pieces < 0) return { ok: false, error: "range" };
  if (
    types > MAX_SCALE.types ||
    slabs > MAX_SCALE.slabs ||
    pieces > MAX_SCALE.pieces
  ) {
    return { ok: false, error: "range" };
  }
  // Purge rejimida tosh yaratilmaydi, lekin generatsiya rejimida 0 tur — mantiqsiz.
  if (!raw.purge && types === 0) return { ok: false, error: "range" };

  // buildPerfDataset: isZeroAvailabilityType(i) === (i % 3 === 0).
  // types=1 → faqat indeks 0 → 100% naligisiz → batchIds bo'sh → slabs/pieces
  // sikllari o'tkazib yuboriladi (W2-B Finding A). Sukutda 0 qator qaytarmaslik
  // uchun: slabs yoki pieces so'ralganda kamida 1 ta «в наличии» tur kerak
  // (types ≥ 2). Nol-availability ulushi (~33.4%) o'zgarmaydi — generator
  // qoidasi tegilmagan; faqat imkonsiz CLI/API kirim rad etiladi.
  if (!raw.purge && (slabs > 0 || pieces > 0) && types < 2) {
    return { ok: false, error: "range" };
  }

  return { ok: true, scale: { types, slabs, pieces }, purge: raw.purge };
}

/** Foydalanish yo'riqnomasi. */
export function usageText(): string {
  return [
    "Usage (yaratish):",
    `  npm run seed:perf -- --yes [--types=${DEFAULT_SCALE.types}] [--slabs=${DEFAULT_SCALE.slabs}] [--pieces=${DEFAULT_SCALE.pieces}]`,
    "",
    "Usage (o'chirish — FAQAT shu generator yaratgan qatorlar):",
    "  npm run seed:perf -- --purge --yes",
    "",
    "env muqobili: SEED_PERF_CONFIRM=yes SEED_PERF_TYPES=… SEED_PERF_SLABS=… SEED_PERF_PIECES=…",
    "",
    "⛔ --yes (yoki SEED_PERF_CONFIRM=yes) BO'LMASA hech narsa qilinmaydi.",
    "   DATABASE_URL ko'pincha LIVE bazaga qaraydi — avval qayerga ulanayotganingizni tekshiring.",
    `   Barcha yozuvlar id'si "${PERF_ID_PREFIX}" bilan boshlanadi, nomi "${PERF_NAME_PREFIX}" bilan.`,
    `   Maksimal hajm: types ≤ ${MAX_SCALE.types}, slabs ≤ ${MAX_SCALE.slabs}, pieces ≤ ${MAX_SCALE.pieces}.`,
    "   slabs yoki pieces > 0 bo'lsa types ≥ 2 kerak (types=1 da barcha turlar",
    "   naligisiz — plita/boy yaratib bo'lmaydi; sukutda 0 qator qaytmaydi).",
  ].join("\n");
}

// ─────────────────────────── sof ma'lumot generatori ───────────────────────────

/** Determinlashtirilgan PRNG (mulberry32) — har safar bir xil to'plam. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ILIKE '%q%' ni haqiqatan ishlatish uchun — xilma-xil, bir-birini qoplaydigan
// so'zlar (masalan «мрамор» ko'p turga, «белый» ko'p rangga tushadi).
const ROCK_TYPES = [
  "мрамор",
  "гранит",
  "оникс",
  "травертин",
  "кварцит",
  "сланец",
  "известняк",
  "базальт",
] as const;

const COLORS = [
  "белый",
  "бежевый",
  "серый",
  "чёрный",
  "медовый",
  "зелёный",
  "розовый",
  "коричневый",
] as const;

const NAME_SUFFIXES = [
  "Classic",
  "Royal",
  "Premium",
  "Rustic",
  "Silk",
  "Storm",
  "Sunset",
  "Aurora",
] as const;

const BLOCKS = ["А", "Б", "В", "Г", "Д"] as const;

/** Har 3-tur — NALICHIYASI YO'Q (pagination bug aynan shu holatda uriladi). */
function isZeroAvailabilityType(index: number): boolean {
  return index % 3 === 0;
}

function padId(prefix: string, n: number): string {
  return `${PERF_ID_PREFIX}${prefix}-${String(n).padStart(7, "0")}`;
}

/** Perf-foydalanuvchilar id'lari (Slab.separatedById / Piece.createdById / bron). */
export const PERF_WAREHOUSE_USER_ID = `${PERF_ID_PREFIX}user-warehouse`;
export const PERF_MANAGER_USER_ID = `${PERF_ID_PREFIX}user-manager`;

export interface PerfDataset {
  users: Prisma.UserCreateManyInput[];
  stoneTypes: Prisma.StoneTypeCreateManyInput[];
  batches: Prisma.BatchCreateManyInput[];
  slabs: Prisma.SlabCreateManyInput[];
  pieces: Prisma.PieceCreateManyInput[];
  reservations: Prisma.ReservationCreateManyInput[];
}

/**
 * Butun to'plamni XOTIRADA quradi (DB'ga tegmaydi) — shuning uchun DB'siz
 * tekshirilishi mumkin. Kafolatlar:
 *   • Slab.label bitta partiya ichida UNIKAL (schema.prisma:254 @@unique([batchId,label]));
 *   • Piece.originSlabId — faqat O'SHA partiyaning mavjud plitasiga (yoki null);
 *   • Batch CHECK (slabsTotal yoki areaTotalM2 NOT NULL) — ikkalasi ham to'ldiriladi;
 *   • Batch qoldig'i (§3) musbat qoladi — «в наличии» turlar haqiqatan naliche;
 *   • ~1/3 tur umuman naligisiz (batch/slab/piece yo'q);
 *   • Reservation BATCH_VOLUME CHECK — batchId NOT NULL, slab/piece NULL,
 *     qtySlabs/qtyAreaM2 dan kamida bittasi to'ldirilgan.
 *
 * `nowMs` — sanalar uchun tayanch nuqta (arrivedAt o'tmishda, faol bron
 * expiresAt kelajakda). Default `Date.now()`: bron haqiqatan FAOL bo'lishi kerak
 * (getBatchReservationHolds `expiresAt > now` filtrlaydi — batch-remainders.ts:238).
 * Aniq qiymat berilsa funksiya TO'LIQ determinlashgan bo'ladi (test/qayta ishlab
 * chiqarish uchun): bir xil (scale, nowMs) → bayt-ma-bayt bir xil natija.
 */
export function buildPerfDataset(
  scale: PerfScale,
  nowMs: number = Date.now(),
): PerfDataset {
  const rnd = mulberry32(20260730);
  const now = nowMs;

  const users: Prisma.UserCreateManyInput[] = [
    {
      id: PERF_WAREHOUSE_USER_ID,
      name: `${PERF_NAME_PREFIX} Складчик`,
      role: "WAREHOUSE",
      // phone/telegramId ATAYLAB null — @unique bo'yicha real akkaunt bilan
      // to'qnashmasligi uchun. email esa aniq «invalid» domenda.
      email: "perf-warehouse@onyx.invalid",
      isActive: true,
    },
    {
      id: PERF_MANAGER_USER_ID,
      name: `${PERF_NAME_PREFIX} Менеджер`,
      role: "MANAGER",
      email: "perf-manager@onyx.invalid",
      isActive: true,
    },
  ];

  const stoneTypes: Prisma.StoneTypeCreateManyInput[] = [];
  const batches: Prisma.BatchCreateManyInput[] = [];
  // Partiya → unga tegishli plita/boy hisoblagichlari (totallarni KEYIN hisoblash
  // uchun: qoldiq musbat chiqishi kerak).
  const batchIds: string[] = [];
  const batchSlabCount = new Map<string, number>();
  const batchDirectPieceCount = new Map<string, number>();
  const batchSlabIds = new Map<string, string[]>();

  for (let i = 0; i < scale.types; i++) {
    const rock = ROCK_TYPES[i % ROCK_TYPES.length];
    const color = COLORS[Math.floor(rnd() * COLORS.length)];
    const suffix = NAME_SUFFIXES[Math.floor(rnd() * NAME_SUFFIXES.length)];
    const stoneTypeId = padId("st", i);

    stoneTypes.push({
      id: stoneTypeId,
      // name @unique — indeks `i` unikallikni kafolatlaydi.
      name: `${PERF_NAME_PREFIX} ${rock} ${suffix} №${i}`,
      rockType: rock,
      // ~12% rangsiz — `color` nullable yo'lini ham qamrab olamiz.
      color: rnd() < 0.12 ? null : color,
      qrSlug: `${PERF_ID_PREFIX}qr-${i}`, // qrSlug @unique
      basePrice: (50 + Math.floor(rnd() * 400)).toFixed(2),
      // ~8% arxivlangan — (isArchived, name) indeksining filtri ish beradi.
      isArchived: rnd() < 0.08,
    });

    if (isZeroAvailabilityType(i)) continue; // naligisiz tur — partiyasiz

    const batchCount = 1 + Math.floor(rnd() * 3); // 1..3
    for (let b = 0; b < batchCount; b++) {
      const batchId = padId("b", batches.length);
      batches.push({
        id: batchId,
        stoneTypeId,
        // ~2 yil ichida tarqoq sanalar.
        arrivedAt: new Date(now - Math.floor(rnd() * 730) * 86_400_000),
        supplierNote: rnd() < 0.3 ? `${PERF_NAME_PREFIX} поставка` : null,
        // slabsTotal / areaTotalM2 pastda, hisoblagichlar ma'lum bo'lgach.
        slabsTotal: 0,
        areaTotalM2: "0",
        needsCheck: rnd() < 0.1,
      });
      batchIds.push(batchId);
      batchSlabCount.set(batchId, 0);
      batchDirectPieceCount.set(batchId, 0);
      batchSlabIds.set(batchId, []);
    }
  }

  // ── Plitalar: partiyalar bo'ylab round-robin (label partiya ichida unikal) ──
  const slabs: Prisma.SlabCreateManyInput[] = [];
  if (batchIds.length > 0) {
    for (let s = 0; s < scale.slabs; s++) {
      const batchId = batchIds[s % batchIds.length];
      const stoneTypeId = batches[s % batchIds.length].stoneTypeId as string;
      const labelNo = (batchSlabCount.get(batchId) ?? 0) + 1;
      batchSlabCount.set(batchId, labelNo);

      const slabId = padId("sl", s);
      const lengthMm = 1800 + Math.floor(rnd() * 1400); // 1800..3200
      const widthMm = 900 + Math.floor(rnd() * 800); // 900..1700
      const r = rnd();
      // Ko'pchilik AVAILABLE (qidiruv aynan shularni sanaydi), qolgani aralash.
      const status =
        r < 0.72 ? "AVAILABLE" : r < 0.85 ? "RESERVED" : r < 0.95 ? "SOLD" : "BROKEN_OFFCUT";

      slabs.push({
        id: slabId,
        batchId,
        stoneTypeId,
        label: `Плита №${labelNo}`,
        status,
        lengthMm,
        widthMm,
        thicknessMm: [2, 3, 4][Math.floor(rnd() * 3)],
        areaM2: ((lengthMm * widthMm) / 1_000_000).toFixed(3),
        isAreaEstimated: rnd() < 0.4,
        block: BLOCKS[Math.floor(rnd() * BLOCKS.length)],
        landmark: String(1 + Math.floor(rnd() * 12)),
        needsCheck: rnd() < 0.1, // TZ §7.4 — sanoqqa kirmaydi
        separatedById: PERF_WAREHOUSE_USER_ID,
      });
      batchSlabIds.get(batchId)?.push(slabId);
    }
  }

  // ── Boy / qoldiqlar ──
  const pieces: Prisma.PieceCreateManyInput[] = [];
  if (batchIds.length > 0) {
    for (let p = 0; p < scale.pieces; p++) {
      const batchId = batchIds[p % batchIds.length];
      const stoneTypeId = batches[p % batchIds.length].stoneTypeId as string;

      // ~20% plitadan chiqqan (originSlabId to'ldirilgan) — §3 formulasiga
      // KIRMAYDI; qolgani to'g'ridan-to'g'ri partiyadan (originSlabId NULL).
      const ownSlabs = batchSlabIds.get(batchId) ?? [];
      const fromSlab = rnd() < 0.2 && ownSlabs.length > 0;
      const originSlabId = fromSlab
        ? ownSlabs[Math.floor(rnd() * ownSlabs.length)]
        : null;
      if (!fromSlab) {
        batchDirectPieceCount.set(
          batchId,
          (batchDirectPieceCount.get(batchId) ?? 0) + 1,
        );
      }

      // Gabaritlar keng tarqalgan — «нужный размер» qidiruvi turli natija bersin.
      const boundingLengthMm = 30 + Math.floor(rnd() * 250); // 30..280 см (ТЗ №12)
      const boundingWidthMm = 20 + Math.floor(rnd() * 160); // 20..180 см
      const r = rnd();
      const status = r < 0.8 ? "AVAILABLE" : r < 0.92 ? "RESERVED" : "SOLD";

      pieces.push({
        id: padId("pc", p),
        stoneTypeId,
        batchId,
        originSlabId,
        kind: rnd() < 0.5 ? "BROKEN" : "OFFCUT",
        status,
        // sidesMm Json (schema.prisma:268) — to'rtburchakka yaqin ko'pburchak.
        sidesMm: [
          boundingLengthMm,
          boundingWidthMm,
          Math.max(1, boundingLengthMm - Math.floor(rnd() * 10)),
          Math.max(1, boundingWidthMm - Math.floor(rnd() * 10)),
        ],
        boundingLengthMm,
        boundingWidthMm,
        thicknessMm: [2, 3, 4][Math.floor(rnd() * 3)],
        // ~10% areaM2 = null — freeRemainderFromAggregate'ning null-yo'li
        // (batch-remainders.ts:105) ham yuklanadi.
        areaM2:
          rnd() < 0.1
            ? null
            : ((boundingLengthMm * boundingWidthMm) / 10_000).toFixed(3),
        block: BLOCKS[Math.floor(rnd() * BLOCKS.length)],
        landmark: String(1 + Math.floor(rnd() * 12)),
        needsCheck: rnd() < 0.1,
        createdById: PERF_WAREHOUSE_USER_ID,
      });
    }
  }

  // ── Partiya totallari: qoldiq (§3) MUSBAT bo'lishi uchun hisoblagichlardan ──
  // slabsFree = slabsTotal + adjusted − soldDirect − slabCount − directPieceCount.
  // adjusted/soldDirect = 0, shuning uchun slabsTotal = ishlatilgan + zaxira.
  for (const batch of batches) {
    const id = batch.id as string;
    const used =
      (batchSlabCount.get(id) ?? 0) + (batchDirectPieceCount.get(id) ?? 0);
    const spare = 5 + Math.floor(rnd() * 40);
    const slabsTotal = used + spare;
    batch.slabsTotal = slabsTotal;
    // O'rtacha ~5.5 m²/plita.
    batch.areaTotalM2 = (slabsTotal * 5.5).toFixed(3);
  }

  // ── BATCH_VOLUME bronlar (BUG-03 yo'li + Reservation kompozit indeksi) ──
  // Partiyalarning ~5%'i uchun. CHECK: batchId NOT NULL, slabId/pieceId NULL,
  // qtySlabs yoki qtyAreaM2 to'ldirilgan (domain_model/migration.sql:482-484).
  const reservations: Prisma.ReservationCreateManyInput[] = [];
  for (let i = 0; i < batchIds.length; i++) {
    if (rnd() >= 0.05) continue;
    const expired = rnd() < 0.3; // muddati o'tganlar ham bo'lsin (filtr sinovi)
    reservations.push({
      id: padId("rs", reservations.length),
      targetType: "BATCH_VOLUME",
      batchId: batchIds[i],
      slabId: null,
      pieceId: null,
      qtySlabs: 1 + Math.floor(rnd() * 4),
      qtyAreaM2: (5 + Math.floor(rnd() * 20)).toFixed(3),
      managerId: PERF_MANAGER_USER_ID,
      customerName: `${PERF_NAME_PREFIX} клиент ${i}`,
      expiresAt: new Date(
        now + (expired ? -1 : 1) * (1 + Math.floor(rnd() * 10)) * 86_400_000,
      ),
      status: "ACTIVE",
    });
  }

  return { users, stoneTypes, batches, slabs, pieces, reservations };
}

// ───────────────────────────────── DB qismi ─────────────────────────────────

/** Massivni CHUNK_SIZE bo'laklarga bo'ladi. */
export function chunk<T>(rows: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface SeedPerfResult {
  users: number;
  stoneTypes: number;
  batches: number;
  slabs: number;
  pieces: number;
  reservations: number;
  ms: number;
}

type Logger = (msg: string) => void;

/**
 * To'plamni bazaga yozadi — createMany + skipDuplicates bilan bo'lak-bo'lak
 * (nested per-row `create` EMAS). skipDuplicates: id'lar determinlashtirilgan,
 * shuning uchun qayta ishga tushirish xatosiz to'ldiradi.
 * FK tartibi: User → StoneType → Batch → Slab → Piece → Reservation.
 */
export async function seedPerfData(
  db: PrismaClient,
  scale: PerfScale,
  log: Logger = () => {},
): Promise<SeedPerfResult> {
  const startedAt = Date.now();
  log(`Ma'lumot generatsiya qilinmoqda (xotirada): ${JSON.stringify(scale)}…`);
  const data = buildPerfDataset(scale);
  log(
    `Tayyor: ${data.stoneTypes.length} tur, ${data.batches.length} partiya, ` +
      `${data.slabs.length} plita, ${data.pieces.length} boy, ${data.reservations.length} bron.`,
  );

  await db.user.createMany({ data: data.users, skipDuplicates: true });

  for (const [i, part] of chunk(data.stoneTypes).entries()) {
    await db.stoneType.createMany({ data: part, skipDuplicates: true });
    log(`  turlar: ${(i + 1) * CHUNK_SIZE > data.stoneTypes.length ? data.stoneTypes.length : (i + 1) * CHUNK_SIZE}/${data.stoneTypes.length}`);
  }
  for (const part of chunk(data.batches)) {
    await db.batch.createMany({ data: part, skipDuplicates: true });
  }
  log(`  partiyalar: ${data.batches.length}/${data.batches.length}`);

  for (const [i, part] of chunk(data.slabs).entries()) {
    await db.slab.createMany({ data: part, skipDuplicates: true });
    log(`  plitalar: ${(i + 1) * CHUNK_SIZE > data.slabs.length ? data.slabs.length : (i + 1) * CHUNK_SIZE}/${data.slabs.length}`);
  }
  for (const [i, part] of chunk(data.pieces).entries()) {
    await db.piece.createMany({ data: part, skipDuplicates: true });
    log(`  boy/qoldiq: ${(i + 1) * CHUNK_SIZE > data.pieces.length ? data.pieces.length : (i + 1) * CHUNK_SIZE}/${data.pieces.length}`);
  }
  for (const part of chunk(data.reservations)) {
    await db.reservation.createMany({ data: part, skipDuplicates: true });
  }
  log(`  bronlar: ${data.reservations.length}/${data.reservations.length}`);

  return {
    users: data.users.length,
    stoneTypes: data.stoneTypes.length,
    batches: data.batches.length,
    slabs: data.slabs.length,
    pieces: data.pieces.length,
    reservations: data.reservations.length,
    ms: Date.now() - startedAt,
  };
}

export interface PurgePerfResult {
  reservations: number;
  pieces: number;
  slabs: number;
  batches: number;
  stoneTypes: number;
  users: number;
  ms: number;
}

/**
 * FAQAT shu generator yaratgan qatorlarni o'chiradi — `id startsWith "perf-"`.
 * Real ma'lumotga TEGMAYDI (real id'lar cuid, "perf-" bilan boshlanmaydi).
 * FK (onDelete: Restrict) sababli tartib teskari:
 *   Reservation → Piece → Slab → Batch → StoneType → User.
 */
export async function deletePerfData(
  db: PrismaClient,
  log: Logger = () => {},
): Promise<PurgePerfResult> {
  const startedAt = Date.now();
  const where = { id: { startsWith: PERF_ID_PREFIX } };

  const reservations = (await db.reservation.deleteMany({ where })).count;
  log(`  bronlar o'chirildi: ${reservations}`);
  const pieces = (await db.piece.deleteMany({ where })).count;
  log(`  boy/qoldiq o'chirildi: ${pieces}`);
  const slabs = (await db.slab.deleteMany({ where })).count;
  log(`  plitalar o'chirildi: ${slabs}`);
  const batches = (await db.batch.deleteMany({ where })).count;
  log(`  partiyalar o'chirildi: ${batches}`);
  const stoneTypes = (await db.stoneType.deleteMany({ where })).count;
  log(`  turlar o'chirildi: ${stoneTypes}`);
  const users = (await db.user.deleteMany({ where })).count;
  log(`  foydalanuvchilar o'chirildi: ${users}`);

  return {
    reservations,
    pieces,
    slabs,
    batches,
    stoneTypes,
    users,
    ms: Date.now() - startedAt,
  };
}
