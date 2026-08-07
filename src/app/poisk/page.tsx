// S1-E — «Поиск камня» (TZ §5.2, §6.5). Server component: GET-forma, klient JS yo'q.
// BATCH-B (perf): butun ombor xotiraga tortilmaydi —
//   • partiya erkin qoldig'i SQL agregatlaridan hisoblanadi (batch-remainders.ts);
//   • gabarit-qidiruv AVAILABLE boy indeksi bo'yicha SQL'da filtrlanadi (JS emas);
//   • vidlar ro'yxati PAGE_SIZE + `?after=<name>` kursor bilan chegaralanadi.
// «В наличии» sonlari o'zgarmaydi — formula (inventory.ts §3) aynan o'sha, faqat
// kirishlari row-fetch o'rniga agregat (par.: src/tests/batch-remainders.test.ts).
//
// W2-A: vidlar sahifasining BUTUN olinishi (so'rov + agregatlar + «наличие»
// filtri + kursor) src/lib/poisk-query.ts ga ko'chirildi — sabab pastda,
// fetchPoiskTypesPage chaqirig'i ustidagi izohda.
//
// W5-A (§3 / §4.6 / §5.2): aniq qoldiq va lokatsiya — faqat
// canSeeExactRemainder (OWNER/MANAGER/WAREHOUSE). PARTNER ko'radi faqat
// neytral «В наличии / Нет в наличии» (kamen/[id] L868–876 va /q pattern).
// Xodimga vid kartochkasida BatchLocation[] ham chiqadi (multi-loc compact).
//
// CHEGARALAR (halol ro'yxat — yuqoridagi «xotiraga tortilmaydi» MUTLAQ emas):
//   • sahifadagi har bir vid uchun `batches` select'ida `where` ham, `take` ham
//     YO'Q — ya'ni butun sahifa vidlarining BARCHA partiya qatorlari o'qiladi,
//     har biriga korrelyatsiyalangan `_count.patterns` bilan. Ko'p partiyali
//     vidda bu chegarasiz o'sadi; to'g'ri yechim — alohida agregat (hali
//     qilinmagan).
//   • naliche filtri JS'da qolgani uchun bo'sh so'rovda modul sahifa to'lguncha
//     bo'laklab o'qiydi: odatdagi holatda AYNAN bitta so'rov (bugungidek), lekin
//     ko'p vid «нет в наличии» bo'lsa POISK_MAX_SCAN_ROWS (1000) xom qatorgacha.
//     Chegara urilsa natija to'liq emas va bu foydalanuvchiga aytiladi.
//   • boy/qoldiq (W6-A2): SQL ORDER BY boundingAreaMm2 (=L×W) + take MAX+1,
//     so'ng rankAndCapFittingPieces (id tie-break + cap). Unbounded fetch YO'Q.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { CUTTING_MARGIN_MM } from "@/lib/inventory";
import {
  piecesWhere,
  slabsWhere,
  batchesPlateWhere,
} from "@/lib/poisk-search";
import {
  fetchPoiskTypesPage,
  rankAndCapFittingPieces,
} from "@/lib/poisk-query";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { SearchIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Поиск камня — Onyx",
};

// Qidiruv har doim joriy DB holatini ko'rsatishi kerak.
export const dynamic = "force-dynamic";

/** Bitta sahifada ko'rsatiladigan vidlar soni (qolgani «Показать ещё» orqali). */
const PAGE_SIZE = 30;
/** §6.5 — max offcuts shown; SQL take = MAX + 1 (probe for cap notice). */
const MAX_POISK_PIECES = 500;
/** Boy/qoldiq blokida BIR marta ko'rsatiladigan qator soni («Показать ещё» qadami).
 *  Vidlar (30) dan kichik: qoldiq kartochkasi 3 qatorli va bu blok «предложить
 *  первыми» — menejerga avval eng kichik bir nechtasi kerak, butun dumi emas. */
const PIECES_PAGE_SIZE = 20;

/** Vid kartochkasida bir qatorda ko'rsatiladigan unikal lokatsiyalar (keyin «и ещё N»). */
const TYPE_LOCATIONS_MAX = 3;

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

type ParamValue = string | string[] | undefined;

function firstParam(v: ParamValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Bitta gabarit maydonining tahlili — foydalanuvchiga qaytarish uchun `raw` ham. */
type DimInput = {
  /** Foydalanuvchi kiritgani (trim qilingan). */
  raw: string;
  /** Qidiruvda ISHLATILGAN qiymat; null → yaroqsiz yoki bo'sh. */
  mm: number | null;
  /** `raw` sonli, lekin aynan `mm` emas: «120.5»→120, «12abc»→12, «012»→12. */
  coerced: boolean;
};

/** parseInt semantikasi ATAYIN saqlangan (xatti-harakat o'zgarmaydi) — yangisi
 *  faqat shu: nima bo'lganini chaqiruvchiga aytadi, jimgina yutmaydi. */
function parseDim(v: ParamValue): DimInput {
  const raw = firstParam(v);
  if (!raw) return { raw, mm: null, coerced: false };
  const n = Number.parseInt(raw, 10);
  const mm = Number.isFinite(n) && n > 0 ? n : null;
  return { raw, mm, coerced: mm !== null && String(mm) !== raw };
}

/** «Показать ещё» bilan ochilgan qoldiqlar soni (`?pn=`). Chegara — SQL cap. */
function parseShownPieces(v: ParamValue): number {
  const n = Number.parseInt(firstParam(v), 10);
  if (!Number.isFinite(n) || n <= 0) return PIECES_PAGE_SIZE;
  return Math.min(n, MAX_POISK_PIECES);
}

/** q/l/w + IKKALA «Показать ещё» holatini saqlab havola quradi.
 *  `after` — vidlar keyset kursori, `pn` — ochilgan qoldiqlar soni. Ikkalasi bir
 *  havolada ham yuriladi: bloklar mustaqil, biri ikkinchisini nolga qaytarmasin. */
function buildHref(base: {
  q: string;
  l: number | null;
  w: number | null;
  after?: string | null;
  pn?: number | null;
  hash?: string;
}): string {
  const sp = new URLSearchParams();
  if (base.q) sp.set("q", base.q);
  if (base.l !== null) sp.set("l", String(base.l));
  if (base.w !== null) sp.set("w", String(base.w));
  if (base.after) sp.set("after", base.after);
  if (base.pn) sp.set("pn", String(base.pn));
  return "/poisk?" + sp.toString() + (base.hash ?? "");
}

/**
 * W5-A — BatchLocation[] ni vid kartochkasiga yig'ish (kompakt).
 * • Unikal (block, landmark) juftliklari (bir joy bir nechta partiyada bo'lishi mumkin).
 * • Har bir joy: «Блок А, ор. 2» — kamen kartochkasi bilan bir xil leksika.
 * • 3 tadan ortiq bo'lsa: dastlabki 3 + «и ещё N» (kartochkani shishirmaslik).
 * Bo'sh ro'yxat → null (UI qatorni chizmaydi).
 *
 * Export — unit-test uchun (page.tsx Next module; test faqat sof funksiyani oladi).
 */
export function formatTypeLocations(
  locs: ReadonlyArray<{ block: string; landmark: string }>,
  maxPoints: number = TYPE_LOCATIONS_MAX,
): string | null {
  const seen = new Set<string>();
  const unique: Array<{ block: string; landmark: string }> = [];
  for (const loc of locs) {
    const key = `${loc.block}\0${loc.landmark}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ block: loc.block, landmark: loc.landmark });
  }
  if (unique.length === 0) return null;

  const labels = unique.map((l) => `Блок ${l.block}, ор. ${l.landmark}`);
  if (labels.length <= maxPoints) return labels.join(" · ");
  const rest = labels.length - maxPoints;
  return `${labels.slice(0, maxPoints).join(" · ")} · и ещё ${rest}`;
}

export default async function PoiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ParamValue>>;
}) {
  // §3 / §4.6 — aniq qoldiq va lokatsiya faqat canSeeExactRemainder.
  // /q: isStaff = caps.canSeeExactRemainder; /kamen: !caps.canSeeExactRemainder → «В наличии».
  const [params, caps] = await Promise.all([searchParams, getCapabilities()]);
  const canSeeExact = caps.canSeeExactRemainder;

  const q = firstParam(params.q);
  const lenDim = parseDim(params.l);
  const widDim = parseDim(params.w);
  const lenMm = lenDim.mm;
  const widMm = widDim.mm;
  const hasDims = lenMm !== null && widMm !== null;
  const after = firstParam(params.after);
  const shownPieces = parseShownPieces(params.pn);

  // Kiritilgan, lekin ishlatib bo'lmagan o'lcham JIMGINA yutilmasin: ilgari
  // faqat `l` (yoki «abc», «0») kiritilsa butun boy/qoldiq bloki hech qanday
  // izohsiz yo'qolardi — foydalanuvchi buni «omborda yo'q» deb o'qiydi.
  const dimNotes: string[] = [];
  for (const [label, d] of [
    ["Длина", lenDim],
    ["Ширина", widDim],
  ] as const) {
    if (d.raw && d.mm === null) {
      dimNotes.push(
        `${label}: «${d.raw}» — так размер не задают. Нужно целое число сантиметров, больше нуля.`,
      );
    } else if (d.coerced) {
      dimNotes.push(
        `${label}: «${d.raw}» принято как ${d.mm} см (дробная часть и лишние символы не учитываются).`,
      );
    }
  }
  if (!hasDims && (lenMm !== null || widMm !== null)) {
    dimNotes.push(
      "Нужны обе стороны: подбор боя и остатков включается, только когда заданы и длина, и ширина.",
    );
  }
  // TG-B1: fotozapros natijasi — redirect'dan qaytgan ?photo=ok/?photoErr
  // bayroqlarini FlashToaster (layout) toast qilib ko'rsatadi va URL'dan tozalaydi.

  // ── Vidlar: chegaralangan sahifa. W2-A — sahifalash, agregatlar va «наличие»
  // filtri endi BITTA joyda: fetchPoiskTypesPage (src/lib/poisk-query.ts).
  //
  // NEGA ko'chirildi (bu sahifadagi XATOning o'zi): ilgari SQL `take: PAGE_SIZE + 1`
  // filtrdan OLDIN ishlardi, «наличие» filtri esa (`types.filter(hasAvailability)`)
  // keyin — JS'da. Natijada bo'sh so'rov + o'lchamsiz holatda 30 ta o'rniga bir
  // nechta (yoki nol) qator chiqar, «Показать ещё» esa baribir turardi —
  // «Ничего не найдено.» + «Показать ещё» yolg'on juftligi. Modul sahifa
  // TO'LGUNCHA o'qiydi (qattiq chegara: POISK_MAX_SCAN_ROWS xom qator), kursorni
  // esa o'qilgan OXIRGI xom qatorda qoldiradi — shuning uchun qator na tushib
  // qoladi, na takrorlanadi.
  //
  // Modul invarianti: `nextCursor !== null` ⟺ «yana bor». Bu yerda «Показать ещё»
  // aynan `nextCursor`ga qarab chiziladi (pastda), demak havola hech qachon
  // «o'lik» bo'lmaydi. `q` yoki gabarit berilganda filtr QO'LLANMAYDI — xatti-
  // harakat bugungidek qoladi.
  const typesPage = await fetchPoiskTypesPage(db, {
    q,
    hasDims,
    after,
    pageSize: PAGE_SIZE,
  });
  const visibleTypes = typesPage.types;
  const nextCursor = typesPage.nextCursor;
  // Skan chegarasi sahifa to'lmasdan tugadi VA kursordan keyin hali xom qatorlar
  // bor → ro'yxat TO'LIQ EMAS, buni foydalanuvchi bilishi shart (jimgina
  // yutilmaydi). Muhim nuance: `truncated && nextCursor === null` — bu aslida
  // TO'LIQ natija (skan jadval oxiriga aynan chegarada yetgan, keyin hech narsa
  // qolmagan), shuning uchun u ogohlantirish EMAS, oddiy «Ничего не найдено.».
  const typesIncomplete = typesPage.truncated && nextCursor !== null;

  // TZ §5.2 / §6.5: gabarit berilganda AVVAL boy va qoldiqlar.
  // Filtr SQL'da (status + bounding + material) — pieceFitsRequest OR.
  //
  // W6-A2 ranking: SQL `ORDER BY boundingAreaMm2 ASC, id ASC` + `take: MAX+1`
  // (generated = L×W — display kaliti bilan bir xil). So'ng
  // rankAndCapFittingPieces: xuddi shu kalit + id, cap probe.
  // OLD: areaM2 pre-cap (noto'g'ri kalit) yoki unbounded full match fetch.
  const needMax = hasDims ? Math.max(lenMm, widMm) + CUTTING_MARGIN_MM : 0;
  const needMin = hasDims ? Math.min(lenMm, widMm) + CUTTING_MARGIN_MM : 0;

  // Parallel: boy/qoldiq + (faqat xodim) sahifa vidlarining BatchLocation[].
  // poisk-query.ts GA TEGMAYMIZ — lokatsiya presentation-layer so'rovi.
  const batchIdsForLocs =
    canSeeExact && visibleTypes.length > 0
      ? visibleTypes.flatMap((t) => t.st.batches.map((b) => b.id))
      : [];
  const batchToStoneId = new Map<string, string>();
  if (canSeeExact) {
    for (const t of visibleTypes) {
      for (const b of t.st.batches) batchToStoneId.set(b.id, t.st.id);
    }
  }

  type FittingPieceRow = {
    id: string;
    kind: string;
    needsCheck: boolean;
    boundingLengthMm: number;
    boundingWidthMm: number;
    thicknessMm: number | null;
    areaM2: { toString(): string } | null;
    block: string;
    landmark: string;
    stoneType: { name: string };
  };

  type FittingSlabRow = {
    id: string;
    label: string;
    lengthMm: number | null;
    widthMm: number | null;
    thicknessMm: number | null;
    areaM2: { toString(): string } | null;
    block: string;
    landmark: string;
    stoneType: { id: string; name: string };
  };
  type FittingBatchRow = {
    id: string;
    lengthMm: number | null;
    widthMm: number | null;
    thicknessMm: number | null;
    arrivedAt: Date;
    slabsTotal: number | null;
    areaTotalM2: { toString(): string } | null;
    stoneType: { id: string; name: string };
    patterns: Array<{
      lengthMm: number | null;
      widthMm: number | null;
      thicknessMm: number | null;
      description: string;
    }>;
  };

  const [fittingPiecesMatched, fittingSlabsMatched, fittingBatchesMatched, batchLocs] =
    await Promise.all([
      hasDims
        ? (db.piece.findMany({
            where: piecesWhere(q, needMax, needMin),
            select: {
              id: true,
              kind: true,
              needsCheck: true,
              boundingLengthMm: true,
              boundingWidthMm: true,
              thicknessMm: true,
              areaM2: true,
              block: true,
              landmark: true,
              stoneType: { select: { name: true } },
            },
            orderBy: [{ boundingAreaMm2: "asc" }, { id: "asc" }],
            take: MAX_POISK_PIECES + 1,
          }) as Promise<FittingPieceRow[]>)
        : Promise.resolve([] as FittingPieceRow[]),
      // ТЗ №12: целые плиты под размер (именованные Slab).
      hasDims
        ? (db.slab.findMany({
            where: slabsWhere(q, needMax, needMin),
            select: {
              id: true,
              label: true,
              lengthMm: true,
              widthMm: true,
              thicknessMm: true,
              areaM2: true,
              block: true,
              landmark: true,
              stoneType: { select: { id: true, name: true } },
            },
            orderBy: [{ lengthMm: "asc" }, { widthMm: "asc" }, { id: "asc" }],
            take: MAX_POISK_PIECES + 1,
          }) as Promise<FittingSlabRow[]>)
        : Promise.resolve([] as FittingSlabRow[]),
      // ТЗ №12: партии с форматом плиты L×W (Batch / Pattern).
      hasDims
        ? (db.batch.findMany({
            where: batchesPlateWhere(q, needMax, needMin),
            select: {
              id: true,
              lengthMm: true,
              widthMm: true,
              thicknessMm: true,
              arrivedAt: true,
              slabsTotal: true,
              areaTotalM2: true,
              stoneType: { select: { id: true, name: true } },
              patterns: {
                select: {
                  lengthMm: true,
                  widthMm: true,
                  thicknessMm: true,
                  description: true,
                },
              },
            },
            orderBy: [{ arrivedAt: "desc" }],
            take: MAX_POISK_PIECES + 1,
          }) as Promise<FittingBatchRow[]>)
        : Promise.resolve([] as FittingBatchRow[]),
      batchIdsForLocs.length > 0
        ? db.batchLocation.findMany({
            where: { batchId: { in: batchIdsForLocs } },
            select: { batchId: true, block: true, landmark: true },
            orderBy: [{ block: "asc" }, { landmark: "asc" }],
          })
        : Promise.resolve(
            [] as Array<{ batchId: string; block: string; landmark: string }>,
          ),
    ]);

  const slabsCapped = fittingSlabsMatched.length > MAX_POISK_PIECES;
  const fittingSlabs = slabsCapped
    ? fittingSlabsMatched.slice(0, MAX_POISK_PIECES)
    : fittingSlabsMatched;
  const batchesCapped = fittingBatchesMatched.length > MAX_POISK_PIECES;
  const fittingBatches = batchesCapped
    ? fittingBatchesMatched.slice(0, MAX_POISK_PIECES)
    : fittingBatchesMatched;

  // Камни, у которых есть целая плита/партия под размер (для фильтра списка видов).
  const plateFitStoneIds = new Set<string>();
  for (const s of fittingSlabs) plateFitStoneIds.add(s.stoneType.id);
  for (const b of fittingBatches) plateFitStoneIds.add(b.stoneType.id);

  // stoneTypeId → unikal lokatsiyalar (partiyalar bo'ylab yig'ilgan).
  const locsByStoneId = new Map<
    string,
    Array<{ block: string; landmark: string }>
  >();
  for (const loc of batchLocs) {
    const stoneId = batchToStoneId.get(loc.batchId);
    if (!stoneId) continue;
    const arr = locsByStoneId.get(stoneId) ?? [];
    arr.push({ block: loc.block, landmark: loc.landmark });
    locsByStoneId.set(stoneId, arr);
  }

  // §6.5: L×W + id (SQL bilan bir xil kalit); cap from take+1 probe.
  const ranked = rankAndCapFittingPieces(
    fittingPiecesMatched,
    MAX_POISK_PIECES,
  );
  const fittingPieces = ranked.ranked;
  const piecesCapped = ranked.capped;

  // ТЗ №12: при поиске по размеру в «Целые плиты и партии» — только виды,
  // у которых есть партия/плита под габарит (иначе список снова «все подряд»).
  const visibleTypesForDims = hasDims
    ? visibleTypes.filter((row) => plateFitStoneIds.has(row.st.id))
    : visibleTypes;

  // «Показать ещё» = ko'rsatilayotgan PREFIKSNI uzaytirish (offset-sahifa emas):
  // foydalanuvchi doim joriy tartibning [0, N) boshini ko'radi, shuning uchun
  // qator na tushib qoladi, na takrorlanadi — hatto ro'yxat so'rovlar orasida
  // o'zgarsa ham. Keyset: tartib kaliti endi DB'da (boundingAreaMm2); UI
  // prefiks kengayishi baribir pn orqali.
  const visiblePieces = fittingPieces.slice(0, shownPieces);
  const hasMorePieces = fittingPieces.length > visiblePieces.length;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Поиск камня
        </h1>
      </header>

      <Card>
        <form method="get" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-sm font-semibold text-ink">
              Название / порода / цвет
            </label>
            <input
              id="q"
              name="q"
              type="search"
              inputMode="search"
              defaultValue={q}
              placeholder="травертин, мрамор, бежевый…"
              className={inputClass}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Нужный размер (см)
            </legend>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                name="l"
                type="text"
                inputMode="numeric"
                // Yaroqli bo'lsa — qidiruvda ISHLATILGAN son (maydon o'zini
                // tuzatadi), yaroqsiz bo'lsa — kiritilgani (tuzatib bo'lsin).
                defaultValue={lenDim.mm ?? lenDim.raw}
                placeholder="Длина"
                className={inputClass}
              />
              <span className="text-ink/50">×</span>
              <input
                name="w"
                type="text"
                inputMode="numeric"
                defaultValue={widDim.mm ?? widDim.raw}
                placeholder="Ширина"
                className={inputClass}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink/60">
              Подбор с запасом на рез {CUTTING_MARGIN_MM} см; поворот заготовки
              учитывается.
            </p>
          </fieldset>

          <Button type="submit" className="w-full sm:w-auto sm:self-start">
            <SearchIcon className="h-5 w-5" />
            Найти
          </Button>
        </form>
      </Card>

      {/* O'lcham kiritilgan-u, ishlatib bo'lmagan bo'lsa — jimgina yutmaymiz.
          hasDims bo'lsa blok ishladi (faqat aniqlashtirish) → info; bo'lmasa
          butun boy/qoldiq bloki chiqmadi → warning. */}
      {dimNotes.length > 0 && (
        <Alert
          variant={hasDims ? "info" : "warning"}
          title={hasDims ? "Размеры уточнены" : "Подбор по размеру не выполнен"}
          className="mt-6"
        >
          {dimNotes.length === 1 ? (
            <p className="text-sm">{dimNotes[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {dimNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {hasDims && (
        <section
          id="ostatki"
          className="mt-6 scroll-mt-4 rounded-card border border-warning/40 bg-warning/10 p-4"
        >
          <h2 className="text-lg font-bold text-ink">
            Бой и остатки — предложить первыми
          </h2>
          <p className="text-sm text-ink/70">
            Под размер {lenMm}×{widMm} см (с запасом на рез)
            {/* Aniq «N из M» — qoldiq inventar soni; PARTNER ga yopiq. */}
            {canSeeExact && fittingPieces.length > 0 && (
              <>
                {" "}
                · показано {visiblePieces.length} из {fittingPieces.length}
                {piecesCapped && "+"}
              </>
            )}
          </p>
          {fittingPieces.length === 0 ? (
            <p className="mt-3 text-sm text-ink/70">
              Подходящих остатков и боя нет — ниже целые плиты и партии.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {visiblePieces.map((p) => (
                <li
                  key={p.id}
                  className="rounded-card border border-ink/10 bg-paper p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                    <span>{p.stoneType.name}</span>
                    <Badge variant="neutral">
                      {PIECE_KIND_RU[p.kind] ?? p.kind}
                    </Badge>
                    {canSeeExact && p.needsCheck && (
                      <Badge variant="warning">требует проверки</Badge>
                    )}
                  </div>
                  <div className="text-sm text-ink/70">
                    Габарит {p.boundingLengthMm}×{p.boundingWidthMm} см
                    {canSeeExact && p.thicknessMm !== null && (
                      <> · толщина {p.thicknessMm} см</>
                    )}
                    {canSeeExact && p.areaM2 !== null && (
                      <> · ≈{m2Fmt.format(Number(p.areaM2))} м²</>
                    )}
                  </div>
                  {/* §4.6 — lokatsiya faqat canSeeExactRemainder. */}
                  {canSeeExact && (
                    <div className="text-sm text-ink">
                      Блок {p.block}, ориентир {p.landmark}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canSeeExact && hasMorePieces && (
            <div className="mt-3">
              <Link
                href={buildHref({
                  q,
                  l: lenMm,
                  w: widMm,
                  after,
                  pn: visiblePieces.length + PIECES_PAGE_SIZE,
                  hash: "#ostatki",
                })}
                className={buttonClass("secondary", "sm")}
              >
                Показать ещё бой и остатки →
              </Link>
            </div>
          )}

          {canSeeExact && piecesCapped && (
            <p className="mt-3 text-sm font-medium text-warning">
              Показаны первые {MAX_POISK_PIECES} подходящих — это предел выдачи,
              часть остатков в список не попала. Уточните размер или материал.
            </p>
          )}
        </section>
      )}

      {/* ТЗ №12: именованные плиты под размер */}
      {hasDims && (
        <section className="mt-6 rounded-card border border-gold/30 bg-gold/5 p-4">
          <h2 className="text-lg font-bold text-ink">Целые плиты под размер</h2>
          <p className="text-sm text-ink/70">
            Именованные плиты {lenMm}×{widMm} см (с запасом на рез)
            {canSeeExact && fittingSlabs.length > 0 && (
              <> · показано {fittingSlabs.length}{slabsCapped ? "+" : ""}</>
            )}
          </p>
          {fittingSlabs.length === 0 ? (
            <p className="mt-3 text-sm text-ink/70">
              Именованных плит под размер нет — ниже партии с форматом плиты, если есть.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {fittingSlabs.map((s) => (
                <li
                  key={s.id}
                  className="rounded-card border border-ink/10 bg-paper p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 font-medium text-ink">
                    <Link
                      href={"/kamen/" + s.stoneType.id}
                      className="text-gold-deep hover:underline"
                    >
                      {s.stoneType.name}
                    </Link>
                    <Badge variant="neutral">{s.label}</Badge>
                  </div>
                  <div className="text-sm text-ink/70">
                    Габарит {s.lengthMm}×{s.widthMm} см
                    {canSeeExact && s.thicknessMm != null && (
                      <> · толщина {s.thicknessMm} см</>
                    )}
                    {canSeeExact && s.areaM2 != null && (
                      <> · ≈{m2Fmt.format(Number(s.areaM2))} м²</>
                    )}
                  </div>
                  {canSeeExact && (
                    <div className="text-sm text-ink">
                      Блок {s.block}, ориентир {s.landmark}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canSeeExact && slabsCapped && (
            <p className="mt-3 text-sm font-medium text-warning">
              Показаны первые {MAX_POISK_PIECES} плит — уточните размер или материал.
            </p>
          )}
        </section>
      )}

      {/* ТЗ №12: партии с известным форматом плиты */}
      {hasDims && fittingBatches.length > 0 && (
        <section className="mt-6 rounded-card border border-line bg-paper-2 p-4">
          <h2 className="text-lg font-bold text-ink">Партии — формат плиты под размер</h2>
          <p className="text-sm text-ink/70">
            Партии, где длина×ширина плиты подходит под запрос (см)
            {canSeeExact && (
              <> · показано {fittingBatches.length}{batchesCapped ? "+" : ""}</>
            )}
          </p>
          <ul className="mt-3 space-y-2">
            {fittingBatches.map((b) => {
              const fmt =
                b.lengthMm != null && b.widthMm != null
                  ? `${b.lengthMm}×${b.widthMm}${b.thicknessMm != null ? `×${b.thicknessMm}` : ""} см`
                  : b.patterns
                      .filter((p) => p.lengthMm != null && p.widthMm != null)
                      .map(
                        (p) =>
                          `${p.description}: ${p.lengthMm}×${p.widthMm}${p.thicknessMm != null ? `×${p.thicknessMm}` : ""} см`,
                      )
                      .join("; ") || "—";
              return (
                <li
                  key={b.id}
                  className="rounded-card border border-ink/10 bg-paper p-3"
                >
                  <Link
                    href={"/kamen/" + b.stoneType.id}
                    className="font-medium text-gold-deep hover:underline"
                  >
                    {b.stoneType.name}
                  </Link>
                  <div className="text-sm text-ink/70">
                    Плита: {fmt}
                    {canSeeExact && b.slabsTotal != null && (
                      <> · {b.slabsTotal} плит</>
                    )}
                    {canSeeExact && b.areaTotalM2 != null && (
                      <> · ≈{m2Fmt.format(Number(b.areaTotalM2))} м²</>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {canSeeExact && batchesCapped && (
            <p className="mt-3 text-sm font-medium text-warning">
              Показаны первые {MAX_POISK_PIECES} партий.
            </p>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-ink">
          {hasDims ? "Целые плиты и партии" : "В наличии"}
        </h2>
        {/* «Ничего не найдено.» va «Показать ещё» BIRGA chiqishi — aynan shu
            xatoning ko'rinadigan alomati edi. Endi bo'sh natijadagi xabar
            `nextCursor`ning YO'Qligiga bog'langan, «Показать ещё» esa (pastda)
            uning BORligiga — ikkovi bir-birini SINTAKTIK istisno qiladi, ya'ni
            juftlik modul nima qaytarishidan qat'i nazar imkonsiz.
            Kursor bor-u ro'yxat bo'sh (skan chegarasi urilgan holat) → «hech
            narsa yo'q» emas, «davom etadi» deb aytiladi. */}
        {visibleTypesForDims.length === 0 ? (
          nextCursor && !hasDims ? (
            <Alert
              variant="warning"
              title="Поиск продолжается"
              className="mt-3"
            >
              <p className="text-sm">
                Просмотрено подряд {typesPage.scannedRows} видов — все они не в
                наличии. Это не весь склад: нажмите «Показать ещё», чтобы идти
                дальше, или уточните название, породу или цвет.
              </p>
            </Alert>
          ) : (
            <p className="mt-3 text-ink/70">
              {hasDims
                ? "Подходящих целых плит и партий под этот размер нет (см. бой/остатки выше, если есть)."
                : "Ничего не найдено."}
            </p>
          )
        ) : (
          <ul className="mt-3 space-y-2.5">
            {visibleTypesForDims.map((t) => {
              // BUG-03: bron bo'lsa — всего/свободно/бронь ajratib ko'rsatiladi;
              // bronsiz — oldingidek bitta son (свободно = всего).
              // Faqat canSeeExact — PARTNER ga aniq sonlar yopiq (§3 / §4.6).
              const totalParts: string[] = [];
              if (canSeeExact) {
                if (t.slabsKnown)
                  totalParts.push(
                    t.reservedSlabsSum > 0
                      ? `плит: всего ~${t.slabsTotalSum}${t.slabsUnknown ? "+" : ""}, свободно ${t.slabsFreeSum}, в брони ${t.reservedSlabsSum}`
                      : `плит ~${t.slabsFreeSum}${t.slabsUnknown ? "+" : ""}`,
                  );
                if (t.areaKnown)
                  totalParts.push(
                    t.reservedAreaSum > 0
                      ? `≈${m2Fmt.format(t.areaTotalSum)} м² всего${t.areaUnknown ? "+" : ""}, свободно ${m2Fmt.format(t.areaFreeSum)}, в брони ${m2Fmt.format(t.reservedAreaSum)}`
                      : `≈${m2Fmt.format(t.areaFreeSum)} м²${t.areaUnknown ? "+" : ""}`,
                  );
              }
              // §6.7 / kamen L868–876: PARTNER — faqat neytral «В наличии».
              const stockLine = canSeeExact
                ? t.hasAvailability
                  ? totalParts.length > 0
                    ? totalParts.join(" · ")
                    : "данных по объёму нет"
                  : "Нет в наличии"
                : t.hasAvailability
                  ? "В наличии"
                  : "Нет в наличии";

              const locLine =
                canSeeExact
                  ? formatTypeLocations(locsByStoneId.get(t.st.id) ?? [])
                  : null;

              // Монограмма по породе (мрамор→М, гранит→Г…) — визуальный якорь
              // без выдуманного цвета (в БД нет hex). Fallback — первая буква вида.
              const monogram = (t.st.rockType || t.st.name)
                .trim()
                .charAt(0)
                .toUpperCase();
              return (
                <li key={t.st.id}>
                  {/* Вся карточка — ссылка на /kamen/[id] (крупная зона касания,
                      hover-lift). Внутри нет других интерактивных элементов. */}
                  <Link
                    href={"/kamen/" + t.st.id}
                    className="group flex items-start gap-3.5 rounded-card border border-line bg-paper-2 p-4 shadow-card transition hover:-translate-y-0.5 hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:gap-4"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/12 font-serif text-lg font-bold text-gold-deep sm:h-12 sm:w-12"
                    >
                      {monogram}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <h3 className="font-bold text-ink transition group-hover:text-gold-deep">
                          {t.st.name}
                        </h3>
                        <span className="text-sm text-ink/55">
                          {t.st.rockType}
                          {t.st.color && <> · {t.st.color}</>}
                        </span>
                      </div>
                      <p className="tnum mt-1.5 text-sm text-ink/70">
                        {stockLine}
                        {canSeeExact && t.hasAvailability && t.countedSlabs > 0 && (
                          <> · отдельных плит: {t.countedSlabs}</>
                        )}
                        {canSeeExact && t.hasAvailability && t.countedPieces > 0 && (
                          <> · боя и остатков: {t.countedPieces}</>
                        )}
                        {canSeeExact && t.patternsCount > 0 && (
                          <> · узоров: {t.patternsCount}</>
                        )}
                        {/* §3 manfiy qoldiq (clamp oldidan) — «требует проверки». */}
                        {canSeeExact && t.remainderNegative && (
                          <>
                            {" "}
                            <Badge variant="warning">требует проверки</Badge>
                          </>
                        )}
                      </p>
                      {/* W5-A / §5.2 — menejer joyini shu yerda ko'radi (kamen'ga
                          o'tmasdan). PARTNER ga chiqmaydi. */}
                      {locLine && (
                        <p className="mt-1 text-sm text-ink/60">{locLine}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 self-center">
                      <Badge variant={t.hasAvailability ? "success" : "neutral"}>
                        {t.hasAvailability ? "В наличии" : "Нет"}
                      </Badge>
                      <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="hidden text-ink/25 transition group-hover:translate-x-0.5 group-hover:text-gold-deep sm:block"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {/* Sahifa TO'LMAGAN, chunki skan chegarasiga yetdi (fittingPieces cap
            ogohlantirishi bilan bir uslubda). Bo'sh natijada bu xabar
            takrorlanmaydi — u yerda yuqoridagi Alert allaqachon aytadi. */}
        {typesIncomplete && visibleTypesForDims.length > 0 && (
          <p className="mt-3 text-sm font-medium text-warning">
            Просмотрено {typesPage.scannedRows} видов — это предел одного шага
            поиска, показаны не все подходящие. Продолжите по «Показать ещё» или
            уточните название, породу или цвет.
          </p>
        )}

        {nextCursor && (
          <div className="mt-4">
            <Link
              href={buildHref({
                q,
                l: lenMm,
                w: widMm,
                after: nextCursor,
                // Vidlar sahifasi almashsa ham qoldiqlar bloki yopilib qolmasin.
                pn: shownPieces,
              })}
              className={buttonClass("secondary", "sm")}
            >
              Показать ещё →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
