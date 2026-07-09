// Карточка камня (TZ §5, п.1.2) — per-stone detail page.
// Server component. Наличие СЧИТАЕТСЯ так же, как в /poisk (ADR-005):
// сумма computeFreeRemainder по партиям (src/lib/inventory.ts). Фото — по
// Photo.stoneTypeId, рендер через прокси /api/photo/[id]. Запрос фото —
// server action requestPhoto (тот же, что в поиске).
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { computeFreeRemainder } from "@/lib/inventory";
import { requestPhoto } from "@/app/poisk/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Карточка камня — Onyx",
};

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const priceFmt = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" });

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

type ParamValue = string | string[] | undefined;

function firstParam(v: ParamValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Prisma Decimal | null → number | null (тот же паттерн, что в /poisk). */
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

/** properties (Json) → массив пар ключ/значение для рендера. */
function propertyRows(properties: unknown): Array<[string, string]> {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.entries(properties as Record<string, unknown>).map(([k, v]) => [
    k,
    v === null || v === undefined
      ? "—"
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v),
  ]);
}

export default async function KamenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, ParamValue>>;
}) {
  const { id } = await params; // Next 16: params — Promise.
  const sp = await searchParams;
  // Результат фотозапроса (redirect'дан қайтган байроқлар, как в /poisk).
  const photoOk = firstParam(sp.photo) === "ok";
  const photoErr = firstParam(sp.photoErr);

  const st = await db.stoneType.findUnique({
    where: { id },
    include: {
      batches: {
        orderBy: { arrivedAt: "asc" },
        include: {
          locations: { orderBy: { createdAt: "asc" } },
          slabs: true,
        },
      },
      pieces: true,
      photos: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!st) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Камень не найден</h1>
        <p className="mt-2 text-gray-600">
          Возможно, он архивирован или ссылка устарела.
        </p>
        <Link href="/poisk" className="mt-4 inline-block text-blue-700 hover:underline">
          ← Поиск
        </Link>
      </main>
    );
  }

  // Наличие: тот же расчёт, что в /poisk — computeFreeRemainder по каждой
  // партии, затем суммирование (null'ы — честно вне суммы, показываем «+»).
  const batches = st.batches.map((b) => {
    // §3: Piece, отколотый от плиты (originSlabId ≠ null), в формулу НЕ входит.
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
    // RESERVED/SOLD/… никогда не «в наличии» — как в /poisk.
    const availableSlabs = b.slabs.filter((s) => s.status === "AVAILABLE");
    return { batch: b, free, availableSlabs };
  });

  // Отдельные бой/остатки в наличии (как в /poisk).
  const availablePieces = st.pieces.filter((p) => p.status === "AVAILABLE");

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

  const totalParts: string[] = [];
  if (slabsKnown)
    totalParts.push(`плит ~${slabsFreeSum}${slabsUnknown ? "+" : ""}`);
  if (areaKnown)
    totalParts.push(`≈${m2Fmt.format(areaFreeSum)} м²${areaUnknown ? "+" : ""}`);

  const basePrice = toNum(st.basePrice);
  const propRows = propertyRows(st.properties);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <Link href="/poisk" className="text-sm text-blue-700 hover:underline">
        ← Поиск
      </Link>

      {/* 1. Заголовок */}
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        {st.name}
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        {st.rockType}
        {st.color && <> · {st.color}</>}
      </p>

      {photoOk && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900"
        >
          Запрос на фото отправлен складчикам.
        </p>
      )}
      {photoErr && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {photoErr}
        </p>
      )}

      {/* 2. Наличие */}
      <section className="mt-6 rounded-xl border border-gray-200 p-4">
        <h2 className="text-lg font-bold">Наличие</h2>
        <p className="mt-1 text-sm">
          {totalParts.length > 0 ? (
            <>
              <span className="font-medium text-green-700">Свободно:</span>{" "}
              {totalParts.join(" · ")}
              {(slabsUnknown && !slabsKnown) || (areaUnknown && !areaKnown) ? (
                <NeedsCheckBadge />
              ) : null}
            </>
          ) : (
            <span className="text-gray-500">Нет в наличии (по объёму партий)</span>
          )}
        </p>
        {slabsUnknown && !slabsKnown && (
          <p className="mt-1 text-xs text-gray-500">
            Количество плит неизвестно — партия учтена только в м².
          </p>
        )}

        {/* Отдельные плиты в наличии — как в /poisk (иначе полностью
            разобранная партия читается как «нет в наличии»). */}
        {batches.some((x) => x.availableSlabs.length > 0) && (
          <div className="mt-3">
            <h3 className="text-sm font-medium text-gray-700">
              Отдельные плиты
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
              {batches.flatMap(({ availableSlabs }) =>
                availableSlabs.map((s) => (
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
                )),
              )}
            </ul>
          </div>
        )}

        {/* Бой и остатки в наличии — как в /poisk. */}
        {availablePieces.length > 0 && (
          <div className="mt-3">
            <h3 className="text-sm font-medium text-gray-700">Бой и остатки</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
              {availablePieces.map((p) => (
                <li key={p.id}>
                  <span className="font-medium">
                    {PIECE_KIND_RU[p.kind] ?? p.kind}
                  </span>{" "}
                  · Габарит {p.boundingLengthMm}×{p.boundingWidthMm} мм
                  {p.thicknessMm !== null && <> · толщина {p.thicknessMm} мм</>}
                  {p.areaM2 !== null && (
                    <> · ≈{m2Fmt.format(Number(p.areaM2))} м²</>
                  )}{" "}
                  · Блок {p.block}, ориентир {p.landmark}
                  {p.needsCheck && <NeedsCheckBadge />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 3. Цена (только basePrice — purchasePrice не показываем) */}
      {basePrice !== null && (
        <section className="mt-4 rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-bold">Цена</h2>
          <p className="mt-1 text-sm">{priceFmt.format(basePrice)} за м²</p>
        </section>
      )}

      {/* 4. Свойства + описание */}
      {(propRows.length > 0 || st.description) && (
        <section className="mt-4 rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-bold">Свойства</h2>
          {propRows.length > 0 && (
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {propRows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 text-sm">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-right font-medium text-gray-900">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {st.description && (
            <p className="mt-2 whitespace-pre-line text-sm text-gray-700">
              {st.description}
            </p>
          )}
        </section>
      )}

      {/* 5. Локации */}
      <section className="mt-4 rounded-xl border border-gray-200 p-4">
        <h2 className="text-lg font-bold">Локации</h2>
        {st.batches.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Партий нет.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {st.batches.map((b) => (
              <li key={b.id} className="rounded-lg bg-gray-50 p-3 text-sm">
                <div className="font-medium">
                  Партия от {dateFmt.format(b.arrivedAt)}
                  {b.needsCheck && <NeedsCheckBadge />}
                </div>
                {b.locations.length === 0 ? (
                  <p className="mt-1 text-gray-500">Локации не указаны.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-gray-700">
                    {b.locations.map((loc) => (
                      <li key={loc.id}>
                        Блок {loc.block}, ориентир {loc.landmark}
                        {loc.slabsHere !== null && <> · ~{loc.slabsHere} плит</>}
                        {loc.areaHereM2 !== null && (
                          <> · ≈{m2Fmt.format(Number(loc.areaHereM2))} м²</>
                        )}
                        {loc.note && (
                          <span className="text-gray-500"> ({loc.note})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Фото */}
      <section className="mt-4 rounded-xl border border-gray-200 p-4">
        <h2 className="text-lg font-bold">Фото</h2>
        {st.photos.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Фото пока нет.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {st.photos.map((p) => (
              <img
                key={p.id}
                src={"/api/photo/" + p.id}
                className="aspect-square w-full rounded border object-cover"
                loading="lazy"
                alt="фото камня"
              />
            ))}
          </div>
        )}
      </section>

      {/* 7. Запросить фото — по каждой локации, либо по партии целиком */}
      {st.batches.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-bold">Запросить фото</h2>
          <ul className="mt-2 space-y-2">
            {st.batches.map((b) => (
              <li key={b.id} className="text-sm">
                <div className="text-gray-600">
                  Партия от {dateFmt.format(b.arrivedAt)}
                </div>
                {b.locations.length === 0 ? (
                  <form action={requestPhoto} className="mt-1">
                    <input type="hidden" name="batchId" value={b.id} />
                    <input type="hidden" name="next" value={"/kamen/" + id} />
                    <button
                      type="submit"
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                    >
                      📷 Запросить фото
                    </button>
                  </form>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {b.locations.map((loc) => (
                      <li key={loc.id}>
                        <form action={requestPhoto} className="flex items-center gap-2">
                          <input type="hidden" name="batchId" value={b.id} />
                          <input
                            type="hidden"
                            name="batchLocationId"
                            value={loc.id}
                          />
                          <input type="hidden" name="next" value={"/kamen/" + id} />
                          <span className="text-gray-700">
                            Блок {loc.block}, ориентир {loc.landmark}
                          </span>
                          <button
                            type="submit"
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                          >
                            📷 Запросить фото
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
