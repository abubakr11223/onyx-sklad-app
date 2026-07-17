// S1-E — «Поиск камня» (TZ §5.2, §6.5). Server component: GET-forma, klient JS yo'q.
// BATCH-B (perf): butun ombor xotiraga tortilmaydi —
//   • partiya erkin qoldig'i SQL agregatlaridan hisoblanadi (batch-remainders.ts);
//   • gabarit-qidiruv AVAILABLE boy indeksi bo'yicha SQL'da filtrlanadi (JS emas);
//   • vidlar ro'yxati take:30 + `?after=<name>` kursor bilan chegaralanadi.
// «В наличии» sonlari o'zgarmaydi — formula (inventory.ts §3) aynan o'sha, faqat
// kirishlari row-fetch o'rniga agregat (par.: src/tests/batch-remainders.test.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { CUTTING_MARGIN_MM } from "@/lib/inventory";
import {
  EMPTY_AGGREGATE,
  freeRemainderFromAggregate,
  getBatchRemainders,
} from "@/lib/batch-remainders";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
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

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

type ParamValue = string | string[] | undefined;

function firstParam(v: ParamValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function parseMm(v: ParamValue): number | null {
  const s = firstParam(v);
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Prisma Decimal | null → number | null. */
function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

/** q/l/w'ni saqlab «Показать ещё» havolasini quradi. */
function buildHref(base: {
  q: string;
  l: number | null;
  w: number | null;
  after: string;
}): string {
  const sp = new URLSearchParams();
  if (base.q) sp.set("q", base.q);
  if (base.l !== null) sp.set("l", String(base.l));
  if (base.w !== null) sp.set("w", String(base.w));
  sp.set("after", base.after);
  return "/poisk?" + sp.toString();
}

export default async function PoiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ParamValue>>;
}) {
  const params = await searchParams;
  const q = firstParam(params.q);
  const lenMm = parseMm(params.l);
  const widMm = parseMm(params.w);
  const hasDims = lenMm !== null && widMm !== null;
  const after = firstParam(params.after);
  // TG-B1: fotozapros natijasi (redirect'dan qaytgan bayroqlar).
  const photoOk = firstParam(params.photo) === "ok";
  const photoErr = firstParam(params.photoErr);

  // ── Vidlar: chegaralangan sahifa (take PAGE_SIZE + 1 → keyingi sahifa bor-yo'qligi).
  // Partiyalarning FAQAT hisoblagichlari olinadi — plita/boy qatorlari EMAS.
  const fetched = await db.stoneType.findMany({
    where: {
      isArchived: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { rockType: { contains: q, mode: "insensitive" } },
              { color: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(after ? { name: { gt: after } } : {}),
    },
    orderBy: { name: "asc" },
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      name: true,
      rockType: true,
      color: true,
      batches: {
        orderBy: { arrivedAt: "asc" },
        select: {
          id: true,
          slabsTotal: true,
          areaTotalM2: true,
          slabsAdjusted: true,
          areaAdjustedM2: true,
          slabsSoldDirect: true,
          areaSoldDirectM2: true,
        },
      },
    },
  });

  const hasMore = fetched.length > PAGE_SIZE;
  const pageTypes = hasMore ? fetched.slice(0, PAGE_SIZE) : fetched;
  const nextCursor = hasMore ? pageTypes[pageTypes.length - 1].name : null;

  const typeIds = pageTypes.map((t) => t.id);
  const batchIds = pageTypes.flatMap((t) => t.batches.map((b) => b.id));

  // Partiya qoldiqlari (agregat) + «отдельных плит / боя и остатков» sonlari
  // (AVAILABLE, needsCheck emas — TZ §7.4) bitta round-trip guruhida.
  const [remainders, slabCounts, pieceCounts] = await Promise.all([
    getBatchRemainders(db, batchIds),
    typeIds.length > 0
      ? db.slab.groupBy({
          by: ["stoneTypeId"],
          where: {
            stoneTypeId: { in: typeIds },
            status: "AVAILABLE",
            needsCheck: false,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    typeIds.length > 0
      ? db.piece.groupBy({
          by: ["stoneTypeId"],
          where: {
            stoneTypeId: { in: typeIds },
            status: "AVAILABLE",
            needsCheck: false,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const slabCountMap = new Map(
    slabCounts.map((g) => [g.stoneTypeId, g._count._all]),
  );
  const pieceCountMap = new Map(
    pieceCounts.map((g) => [g.stoneTypeId, g._count._all]),
  );

  const types = pageTypes.map((st) => {
    // Vid bo'yicha jami: partiyalar erkin qoldig'i (null'lar halol — yig'indidan tashqarida).
    let slabsFreeSum = 0;
    let slabsKnown = false;
    let slabsUnknown = false;
    let areaFreeSum = 0;
    let areaKnown = false;
    let areaUnknown = false;
    for (const b of st.batches) {
      const agg = remainders.get(b.id) ?? EMPTY_AGGREGATE;
      const free = freeRemainderFromAggregate(
        {
          slabsTotal: b.slabsTotal,
          areaTotalM2: toNum(b.areaTotalM2),
          slabsAdjusted: b.slabsAdjusted,
          areaAdjustedM2: Number(b.areaAdjustedM2),
          slabsSoldDirect: b.slabsSoldDirect,
          areaSoldDirectM2: Number(b.areaSoldDirectM2),
        },
        agg,
      );
      if (free.slabsFree === null) slabsUnknown = true;
      else {
        slabsKnown = true;
        slabsFreeSum += free.slabsFree;
      }
      if (free.areaFreeM2 === null) areaUnknown = true;
      else {
        areaKnown = true;
        areaFreeSum += free.areaFreeM2;
      }
    }

    // needsCheck birliklari sonlarga KIRMAYDI (TZ §7.4), lekin naliche summasida.
    const countedSlabs = slabCountMap.get(st.id) ?? 0;
    const countedPieces = pieceCountMap.get(st.id) ?? 0;

    const hasAvailability =
      slabsFreeSum > 0 || areaFreeSum > 0 || countedSlabs > 0 || countedPieces > 0;

    return {
      st,
      slabsFreeSum,
      slabsKnown,
      slabsUnknown,
      areaFreeSum,
      areaKnown,
      areaUnknown,
      countedSlabs,
      countedPieces,
      hasAvailability,
    };
  });

  // Bo'sh so'rov + o'lchamsiz → faqat naligi bor vidlar (talab №2).
  const visibleTypes =
    !q && !hasDims ? types.filter((t) => t.hasAvailability) : types;

  // TZ §5.2 / §6.5: gabarit berilganda AVVAL boy va qoldiqlar. Old kod BARCHA mos
  // boy'ni tortib bounding-maydon (bL*bW) o'sish tartibida saralagan — eng kichik
  // maydonli qoldiq BIRINCHI («продать остатки первыми»). Endi filtr indeks bo'yicha
  // SQL'da (status, boundingLengthMm, boundingWidthMm) — pieceFitsRequest mantig'i
  // (dopusk + 90° burish) ekvivalent OR-shart bilan:
  //   max(L,W) ≥ needMax ∧ min(L,W) ≥ needMin
  //     ⇔ (L≥needMax ∧ W≥needMin) ∨ (L≥needMin ∧ W≥needMax).
  // MUHIM: DB'da CAP QILMAYMIZ va DB tartibiga tayanmaymiz — bounding-maydon indeks
  // ustunida yo'q, shuning uchun cap-then-rank eng kichik-maydonli mosni tushirib
  // qoldirishi mumkin (masalan 2500×60 ni ko'plab 100×2000 to'ldirib qo'yadi). Yengil
  // proyeksiya bilan BARCHA mos boy olinadi (int/decimal ustunlar — qatoriga juda
  // arzon, eski to'liq-include butun-ombor fetchidan ancha yengil), keyin JS'da old
  // kod bilan AYNAN bir xil kalitda (bL*bW o'sish) saralanadi. isArchived=false —
  // eski gabarit yo'li vidlarni `isArchived:false` bo'yicha olardi (arxiv vid boyi
  // chiqmasin).
  const needMax = hasDims ? Math.max(lenMm, widMm) + CUTTING_MARGIN_MM : 0;
  const needMin = hasDims ? Math.min(lenMm, widMm) + CUTTING_MARGIN_MM : 0;
  const fittingPieces = hasDims
    ? await db.piece.findMany({
        where: {
          status: "AVAILABLE",
          stoneType: { isArchived: false },
          OR: [
            {
              boundingLengthMm: { gte: needMax },
              boundingWidthMm: { gte: needMin },
            },
            {
              boundingLengthMm: { gte: needMin },
              boundingWidthMm: { gte: needMax },
            },
          ],
        },
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
      })
    : [];
  // «Предложить первыми» — eng kichik bounding-maydon oldinda (old kod bilan AYNAN bir
  // xil tartib va to'liqlik: cap yo'q → eng kichik-maydonli mos hech qachon tushmaydi).
  fittingPieces.sort(
    (a, b) =>
      a.boundingLengthMm * a.boundingWidthMm -
      b.boundingLengthMm * b.boundingWidthMm,
  );

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
              Нужный размер (мм)
            </legend>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                name="l"
                type="text"
                inputMode="numeric"
                defaultValue={lenMm ?? ""}
                placeholder="Длина"
                className={inputClass}
              />
              <span className="text-ink/50">×</span>
              <input
                name="w"
                type="text"
                inputMode="numeric"
                defaultValue={widMm ?? ""}
                placeholder="Ширина"
                className={inputClass}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink/60">
              Подбор с запасом на рез {CUTTING_MARGIN_MM} мм; поворот заготовки
              учитывается.
            </p>
          </fieldset>

          <Button type="submit" className="w-full sm:w-auto sm:self-start">
            <SearchIcon className="h-5 w-5" />
            Найти
          </Button>
        </form>
      </Card>

      {photoOk && (
        <Alert variant="success" className="mt-4">
          Запрос на фото отправлен складчикам.
        </Alert>
      )}
      {photoErr && (
        <Alert variant="danger" className="mt-4">
          {photoErr}
        </Alert>
      )}

      {hasDims && (
        <section className="mt-6 rounded-card border border-warning/40 bg-warning/10 p-4">
          <h2 className="text-lg font-bold text-ink">
            Бой и остатки — предложить первыми
          </h2>
          <p className="text-sm text-ink/70">
            Под размер {lenMm}×{widMm} мм (с запасом на рез)
          </p>
          {fittingPieces.length === 0 ? (
            <p className="mt-3 text-sm text-ink/70">
              Подходящих остатков и боя нет — ниже целые плиты и партии.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {fittingPieces.map((p) => (
                <li
                  key={p.id}
                  className="rounded-card border border-ink/10 bg-paper p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                    <span>{p.stoneType.name}</span>
                    <Badge variant="neutral">
                      {PIECE_KIND_RU[p.kind] ?? p.kind}
                    </Badge>
                    {p.needsCheck && (
                      <Badge variant="warning">требует проверки</Badge>
                    )}
                  </div>
                  <div className="text-sm text-ink/70">
                    Габарит {p.boundingLengthMm}×{p.boundingWidthMm} мм
                    {p.thicknessMm !== null && <> · толщина {p.thicknessMm} мм</>}
                    {p.areaM2 !== null && (
                      <> · ≈{m2Fmt.format(Number(p.areaM2))} м²</>
                    )}
                  </div>
                  <div className="text-sm text-ink">
                    Блок {p.block}, ориентир {p.landmark}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-ink">
          {hasDims ? "Целые плиты и партии" : "В наличии"}
        </h2>
        {visibleTypes.length === 0 ? (
          <p className="mt-3 text-ink/70">Ничего не найдено.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {visibleTypes.map((t) => {
              const totalParts: string[] = [];
              if (t.slabsKnown)
                totalParts.push(
                  `плит ~${t.slabsFreeSum}${t.slabsUnknown ? "+" : ""}`,
                );
              if (t.areaKnown)
                totalParts.push(
                  `≈${m2Fmt.format(t.areaFreeSum)} м²${t.areaUnknown ? "+" : ""}`,
                );
              return (
                <li
                  key={t.st.id}
                  className="rounded-card border border-ink/10 bg-paper-2/60 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-base font-bold text-ink">
                      <Link
                        href={"/kamen/" + t.st.id}
                        className="hover:text-gold-deep hover:underline"
                      >
                        {t.st.name}
                      </Link>
                    </h3>
                    <span className="text-sm text-ink/60">
                      {t.st.rockType}
                      {t.st.color && <> · {t.st.color}</>}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink/70">
                    {t.hasAvailability ? (
                      <>
                        <Badge variant="success" className="align-middle">
                          В наличии
                        </Badge>{" "}
                        {totalParts.length > 0
                          ? totalParts.join(" · ")
                          : "данных по объёму нет"}
                        {t.countedSlabs > 0 && (
                          <> · отдельных плит: {t.countedSlabs}</>
                        )}
                        {t.countedPieces > 0 && (
                          <> · боя и остатков: {t.countedPieces}</>
                        )}
                      </>
                    ) : (
                      <Badge variant="neutral" className="align-middle">
                        Нет в наличии
                      </Badge>
                    )}
                  </p>
                  {/* Партии/локации/плиты — на карточке камня (/kamen/[id]),
                      в списке поиска только сводка + ссылка. */}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && (
          <div className="mt-4">
            <Link
              href={buildHref({ q, l: lenMm, w: widMm, after: nextCursor })}
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
