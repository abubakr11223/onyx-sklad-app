// S1-E — «Поиск камня» (TZ §5.2, §6.5 minimal versiya).
// Server component: GET-forma, klient JS yo'q. Erkin qoldiq HISOBLANADI
// (ADR-005) — formula src/lib/inventory.ts (data-model.md §3).
// TODO (keyingi sprint): paginatsiya — seed masshtabida findMany yetarli.
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  CUTTING_MARGIN_MM,
  computeFreeRemainder,
  pieceFitsRequest,
} from "@/lib/inventory";

export const metadata: Metadata = {
  title: "Поиск камня — Onyx",
};

// Qidiruv har doim joriy DB holatini ko'rsatishi kerak.
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" });

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

function NeedsCheckBadge() {
  return (
    <span className="ml-2 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
      требует проверки
    </span>
  );
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

  const stoneTypes = await db.stoneType.findMany({
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
    },
    orderBy: { name: "asc" },
    include: {
      batches: {
        orderBy: { arrivedAt: "asc" },
        include: {
          locations: { orderBy: { createdAt: "asc" } },
          slabs: true,
        },
      },
      pieces: true,
    },
  });

  const types = stoneTypes.map((st) => {
    const batches = st.batches.map((b) => {
      // §3: plitadan chiqqan Piece (originSlabId ≠ null) formulaga KIRMAYDI.
      const directPieces = st.pieces.filter(
        (p) => p.batchId === b.id && p.originSlabId === null,
      );
      const free = computeFreeRemainder(
        {
          slabsTotal: b.slabsTotal,
          areaTotalM2: toNum(b.areaTotalM2),
          slabsAdjusted: b.slabsAdjusted,
          areaAdjustedM2: Number(b.areaAdjustedM2),
          slabsSoldDirect: b.slabsSoldDirect,
          areaSoldDirectM2: Number(b.areaSoldDirectM2),
        },
        b.slabs.map((s) => ({ areaM2: toNum(s.areaM2) })),
        directPieces.map((p) => ({ areaM2: toNum(p.areaM2) })),
      );
      // RESERVED/SOLD/… hech qachon «в наличии» emas.
      const availableSlabs = b.slabs.filter((s) => s.status === "AVAILABLE");
      return { batch: b, free, availableSlabs };
    });

    const availablePieces = st.pieces.filter((p) => p.status === "AVAILABLE");

    // Vid bo'yicha jami: partiyalar erkin qoldig'i (null'lar halol — yig'indidan tashqarida).
    let slabsFreeSum = 0;
    let slabsKnown = false;
    let slabsUnknown = false;
    let areaFreeSum = 0;
    let areaKnown = false;
    let areaUnknown = false;
    for (const { free } of batches) {
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

    // needsCheck birliklari sonlarga KIRMAYDI (TZ §7.4), lekin ro'yxatda badge bilan.
    const countedSlabs = batches.reduce(
      (n, x) => n + x.availableSlabs.filter((s) => !s.needsCheck).length,
      0,
    );
    const countedPieces = availablePieces.filter((p) => !p.needsCheck).length;

    const hasAvailability =
      slabsFreeSum > 0 || areaFreeSum > 0 || countedSlabs > 0 || countedPieces > 0;

    return {
      st,
      batches,
      availablePieces,
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

  // TZ §5.2 / §6.5: gabarit berilganda AVVAL boy va qoldiqlar.
  const fittingPieces = hasDims
    ? types
        .flatMap((t) =>
          t.availablePieces
            .filter((p) =>
              pieceFitsRequest(
                p.boundingLengthMm,
                p.boundingWidthMm,
                lenMm,
                widMm,
              ),
            )
            .map((p) => ({ piece: p, stoneName: t.st.name })),
        )
        .sort(
          (a, b) =>
            a.piece.boundingLengthMm * a.piece.boundingWidthMm -
            b.piece.boundingLengthMm * b.piece.boundingWidthMm,
        )
    : [];

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Поиск камня
      </h1>

      <form method="get" className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <label htmlFor="q" className="block text-sm font-medium text-gray-700">
          Название / порода / цвет
        </label>
        <input
          id="q"
          name="q"
          type="text"
          defaultValue={q}
          placeholder="травертин, мрамор, бежевый…"
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
        />
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-gray-700">
            Нужный размер (мм)
          </legend>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="l"
              type="number"
              min={1}
              defaultValue={lenMm ?? ""}
              placeholder="Длина"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
            />
            <span className="text-gray-500">×</span>
            <input
              name="w"
              type="number"
              min={1}
              defaultValue={widMm ?? ""}
              placeholder="Ширина"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Подбор с запасом на рез {CUTTING_MARGIN_MM} мм; поворот заготовки
            учитывается.
          </p>
        </fieldset>
        <button
          type="submit"
          className="mt-3 w-full rounded-lg bg-gray-900 px-4 py-2 font-medium text-white sm:w-auto"
        >
          Найти
        </button>
      </form>

      {hasDims && (
        <section className="mt-6 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
          <h2 className="text-lg font-bold text-amber-900">
            Бой и остатки — предложить первыми
          </h2>
          <p className="text-sm text-amber-800">
            Под размер {lenMm}×{widMm} мм (с запасом на рез)
          </p>
          {fittingPieces.length === 0 ? (
            <p className="mt-3 text-sm text-amber-900">
              Подходящих остатков и боя нет — ниже целые плиты и партии.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {fittingPieces.map(({ piece: p, stoneName }) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-amber-200 bg-white p-3"
                >
                  <div className="font-medium">
                    {stoneName} — {PIECE_KIND_RU[p.kind] ?? p.kind}
                    {p.needsCheck && <NeedsCheckBadge />}
                  </div>
                  <div className="text-sm text-gray-600">
                    Габарит {p.boundingLengthMm}×{p.boundingWidthMm} мм
                    {p.thicknessMm !== null && <> · толщина {p.thicknessMm} мм</>}
                    {p.areaM2 !== null && (
                      <> · ≈{m2Fmt.format(Number(p.areaM2))} м²</>
                    )}
                  </div>
                  <div className="text-sm text-gray-800">
                    Блок {p.block}, ориентир {p.landmark}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold">
          {hasDims ? "Целые плиты и партии" : "В наличии"}
        </h2>
        {visibleTypes.length === 0 ? (
          <p className="mt-3 text-gray-500">Ничего не найдено.</p>
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
                  className="rounded-xl border border-gray-200 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-base font-bold">{t.st.name}</h3>
                    <span className="text-sm text-gray-500">
                      {t.st.rockType}
                      {t.st.color && <> · {t.st.color}</>}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">
                    {t.hasAvailability ? (
                      <>
                        <span className="font-medium text-green-700">
                          В наличии:
                        </span>{" "}
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
                      <span className="text-gray-500">Нет в наличии</span>
                    )}
                  </p>

                  <ul className="mt-3 space-y-3">
                    {t.batches.map(({ batch: b, free, availableSlabs }) => {
                      const freeParts: string[] = [];
                      if (free.slabsFree !== null)
                        freeParts.push(`плит ~${free.slabsFree}`);
                      if (free.areaFreeM2 !== null)
                        freeParts.push(`≈${m2Fmt.format(free.areaFreeM2)} м²`);
                      return (
                        <li
                          key={b.id}
                          className="rounded-lg bg-gray-50 p-3 text-sm"
                        >
                          <div className="font-medium">
                            Партия от {dateFmt.format(b.arrivedAt)} — свободно:{" "}
                            {freeParts.join(" · ")}
                            {b.needsCheck && <NeedsCheckBadge />}
                          </div>
                          <ul className="mt-1 space-y-0.5 text-gray-700">
                            {b.locations.map((loc) => (
                              <li key={loc.id}>
                                Блок {loc.block}, ориентир {loc.landmark}
                                {loc.slabsHere !== null && (
                                  <> · ~{loc.slabsHere} плит</>
                                )}
                                {loc.areaHereM2 !== null && (
                                  <> · ≈{m2Fmt.format(Number(loc.areaHereM2))} м²</>
                                )}
                                {loc.note && (
                                  <span className="text-gray-500">
                                    {" "}
                                    ({loc.note})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {availableSlabs.length > 0 && (
                            <ul className="mt-2 space-y-0.5">
                              {availableSlabs.map((s) => (
                                <li key={s.id}>
                                  <span className="font-medium">{s.label}</span>
                                  {s.lengthMm !== null && s.widthMm !== null && (
                                    <> · {s.lengthMm}×{s.widthMm} мм</>
                                  )}
                                  {s.areaM2 !== null && (
                                    <>
                                      {" "}
                                      · {s.isAreaEstimated ? "≈" : ""}
                                      {m2Fmt.format(Number(s.areaM2))} м²
                                    </>
                                  )}{" "}
                                  · Блок {s.block}, ориентир {s.landmark}
                                  {s.needsCheck && <NeedsCheckBadge />}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
