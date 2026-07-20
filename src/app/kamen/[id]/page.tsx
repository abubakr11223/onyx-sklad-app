// Карточка камня (TZ §5, п.1.2) — per-stone detail page.
// Server component. Наличие СЧИТАЕТСЯ так же, как в /poisk (ADR-005): сумма §3
// формулы по партиям (inventory.ts), входы — SQL-агрегат (batch-remainders.ts). Фото — по
// Photo.stoneTypeId, рендер через прокси /api/photo/[id]. Запрос фото —
// server action requestPhoto (тот же, что в поиске).
//
// BATCH-C: разметка переведена на бренд-дизайн-систему (Card/Alert/Badge/Button
// + Icons) и добавлен лайтбокс фото (PhotoLightbox). Данные, server actions,
// имена полей форм и ролевые гейты (canManageWarehouse/canSeePrices/
// canRequestPhoto) НЕ менялись — правка чисто презентационная.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  EMPTY_AGGREGATE,
  EMPTY_HOLD,
  freeRemainderFromAggregate,
  getBatchRemainders,
  getBatchReservationHolds,
} from "@/lib/batch-remainders";
import {
  PHOTO_STALE_MONTHS_KEY,
  isPhotoStale,
  parsePhotoStaleMonthsConfig,
} from "@/lib/photos";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import { requestPhoto } from "@/app/poisk/actions";
import {
  addLocation,
  moveQty,
  setNeedsCheck,
  updateLocation,
  updateSlabLocation,
} from "@/app/kamen/actions";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { CameraIcon } from "@/components/ui/Icons";
import PhotoLightbox, { type LightboxPhoto } from "./PhotoLightbox";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Карточка камня — Onyx",
};

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const priceFmt = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

// Стиль узкого инлайн-поля склада (SK-1) — бренд-токены, но фиксированная
// ширина под горизонтальную форму (Field даёт w-full/столбец). min-h-11 —
// зона касания 44px (складчик работает с телефона).
const inlineInput =
  "min-h-11 rounded-field border border-ink/20 bg-paper px-2 text-sm text-ink " +
  "placeholder:text-ink/40 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40";

type ParamValue = string | string[] | undefined;

function firstParam(v: ParamValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Prisma Decimal | null → number | null (тот же паттерн, что в /poisk). */
function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

function NeedsCheckBadge() {
  // TZ §5.3: «требует проверки» — ЯНТАРНЫЙ (warning), отделён от danger=ошибка.
  return (
    <Badge variant="warning" className="ml-2 align-middle">
      требует проверки
    </Badge>
  );
}

/**
 * SK-2 — Кнопка-toggle пометки «проверить» (пересорт). Рендерится ТОЛЬКО складу
 * (caps.canManageWarehouse) рядом с badge'ем. Скрытое `value` несёт
 * ПРОТИВОПОЛОЖНОЕ текущему needsCheck, поэтому один клик переключает флаг;
 * подпись отражает текущее состояние (поставить/снять). Server action
 * setNeedsCheck делает defense-in-depth проверку и пишет аудит STATUS_CHANGE.
 */
function NeedsCheckToggle({
  entityType,
  entityId,
  needsCheck,
  backTo,
}: {
  entityType: "Batch" | "Slab" | "Piece";
  entityId: string;
  needsCheck: boolean;
  backTo: string;
}) {
  return (
    <form action={setNeedsCheck} className="ml-2 inline">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      {/* value = ПРОТИВОПОЛОЖНОЕ текущему → toggle */}
      <input type="hidden" name="value" value={needsCheck ? "0" : "1"} />
      <input type="hidden" name="next" value={backTo} />
      <Button type="submit" variant="secondary" size="sm" className="align-middle">
        {needsCheck ? "Снять отметку (проверено)" : "Отметить: требует проверки"}
      </Button>
    </form>
  );
}

/**
 * SK-1b (3) — Правка локации ПЛИТЫ (block/landmark) складом. Инлайн-форма как у
 * локации партии, но без note (у Slab нет такого поля). Server action
 * updateSlabLocation делает defense-in-depth и пишет аудит MOVE.
 */
function SlabLocationForm({
  slabId,
  block,
  landmark,
  backTo,
}: {
  slabId: string;
  block: string;
  landmark: string;
  backTo: string;
}) {
  return (
    <form
      action={updateSlabLocation}
      className="mt-1 flex flex-wrap items-center gap-1.5"
    >
      <input type="hidden" name="slabId" value={slabId} />
      <input type="hidden" name="next" value={backTo} />
      <label className="text-ink/55">Блок</label>
      <input name="block" defaultValue={block} className={inlineInput + " w-16"} />
      <label className="text-ink/55">ориентир</label>
      <input
        name="landmark"
        defaultValue={landmark}
        className={inlineInput + " w-20"}
      />
      <Button type="submit" variant="secondary" size="sm">
        Сохранить локацию плиты
      </Button>
    </form>
  );
}

/**
 * SK-1b (2) — Перенос количества из одной локации партии в другую (A→B).
 * Показываем только когда у партии ≥2 локаций (есть куда переносить). Числовые
 * поля — text + inputMode (НЕ type="number"). Server action moveQty берёт
 * FOR UPDATE на обе строки и не даёт уйти в минус.
 */
function MoveQtyForm({
  sourceId,
  others,
  backTo,
}: {
  sourceId: string;
  others: Array<{ id: string; block: string; landmark: string }>;
  backTo: string;
}) {
  return (
    <form action={moveQty} className="mt-1 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="sourceLocationId" value={sourceId} />
      <input type="hidden" name="next" value={backTo} />
      <span className="text-ink/55">Перенести в</span>
      <select
        name="destLocationId"
        defaultValue=""
        className={inlineInput + " w-44"}
      >
        <option value="" disabled>
          выберите локацию
        </option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            Блок {o.block}, ор. {o.landmark}
          </option>
        ))}
      </select>
      <input
        name="qtySlabs"
        inputMode="numeric"
        placeholder="плит"
        className={inlineInput + " w-16"}
      />
      <input
        name="qtyAreaM2"
        inputMode="decimal"
        placeholder="м²"
        className={inlineInput + " w-16"}
      />
      <Button type="submit" variant="secondary" size="sm">
        Переместить
      </Button>
    </form>
  );
}

/**
 * SK-1b (1) — Добавить НОВУЮ локацию к партии. block/landmark обязательны,
 * ~плиты/≈м²/примечание — опциональны. Числовые поля — text + inputMode.
 * Server action addLocation проверяет права и пишет аудит MOVE(created).
 */
function AddLocationForm({
  batchId,
  backTo,
}: {
  batchId: string;
  backTo: string;
}) {
  return (
    <form action={addLocation} className="mt-2 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="next" value={backTo} />
      <label className="text-ink/55">Блок</label>
      <input name="block" placeholder="А" className={inlineInput + " w-16"} />
      <label className="text-ink/55">ориентир</label>
      <input name="landmark" placeholder="2" className={inlineInput + " w-20"} />
      <input
        name="slabsHere"
        inputMode="numeric"
        placeholder="плит"
        className={inlineInput + " w-16"}
      />
      <input
        name="areaHereM2"
        inputMode="decimal"
        placeholder="м²"
        className={inlineInput + " w-16"}
      />
      <input
        name="note"
        placeholder="примечание"
        className={inlineInput + " w-32"}
      />
      <Button type="submit" variant="secondary" size="sm">
        + Добавить локацию
      </Button>
    </form>
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
  // BUG-04: запрос создан, но НИ ОДИН складчик не получил (нет привязанного
  // Telegram или отправка не удалась) — предупреждаем менеджера, не молчим.
  const photoNoDelivery = firstParam(sp.photo) === "nodelivery";
  const photoErr = firstParam(sp.photoErr);
  // SK-1: результат правки локации (redirect'дан қайтган байроқлар, §5.7).
  const locOk = firstParam(sp.locOk) === "1";
  const locErr = firstParam(sp.locErr);
  // SK-2: результат ручной пометки «проверить» (пересорт, STATUS_CHANGE).
  const checkOk = firstParam(sp.checkOk) === "1";
  const checkErr = firstParam(sp.checkErr);

  // R2 — rol gate: наличие/фото/локации видит и склад, а вот цену (canSeePrices)
  // и «Запросить фото» (§7, canRequestPhoto) — только соответствующие роли.
  // getCapabilities() — в общий Promise.all, чтобы не добавлять лишний
  // последовательный round-trip на самой горячей странице.
  const [st, photoCfg, caps] = await Promise.all([
    // BATCH-B (perf): весь склад не тянем. Для формулы §3 — счётчики партий +
    // агрегаты (getBatchRemainders ниже); для показа — только AVAILABLE плиты/куски
    // и последние 12 фото. Наличие и «свежесть» фото (TG-C) считаются так же.
    db.stoneType.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        rockType: true,
        color: true,
        basePrice: true,
        description: true,
        properties: true,
        batches: {
          orderBy: { arrivedAt: "asc" },
          select: {
            id: true,
            arrivedAt: true,
            needsCheck: true,
            slabsTotal: true,
            areaTotalM2: true,
            slabsAdjusted: true,
            areaAdjustedM2: true,
            slabsSoldDirect: true,
            areaSoldDirectM2: true,
            locations: { orderBy: { createdAt: "asc" } },
            // Показываем только плиты «в наличии» (SOLD/RESERVED не рендерим).
            slabs: {
              where: { status: "AVAILABLE" },
              select: {
                id: true,
                label: true,
                lengthMm: true,
                widthMm: true,
                areaM2: true,
                isAreaEstimated: true,
                block: true,
                landmark: true,
                needsCheck: true,
              },
            },
          },
        },
        pieces: {
          where: { status: "AVAILABLE" },
          select: {
            id: true,
            kind: true,
            boundingLengthMm: true,
            boundingWidthMm: true,
            thicknessMm: true,
            areaM2: true,
            block: true,
            landmark: true,
            needsCheck: true,
            // AI-чертёж (§5.5): data:image/svg+xml URI, показываем как <img>.
            drawingUrl: true,
          },
        },
        // «Показать все» — задел на следующий батч (пагинация фото).
        photos: { orderBy: { createdAt: "desc" }, take: 12 },
      },
    }),
    db.appConfig.findUnique({
      where: { key: PHOTO_STALE_MONTHS_KEY },
      select: { value: true },
    }),
    getCapabilities(),
  ]);
  // TZ §5.3: фото старше N месяцев → пометка «возможно, переснять» (default 6).
  const photoStaleMonths = parsePhotoStaleMonthsConfig(photoCfg?.value);

  if (!st) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Камень не найден
        </h1>
        <p className="mt-2 text-base text-ink/70">
          Возможно, он архивирован или ссылка устарела.
        </p>
        <Link
          href="/poisk"
          className="mt-4 inline-block text-sm font-medium text-gold-deep hover:underline"
        >
          ← Поиск
        </Link>
      </main>
    );
  }

  // Наличие: тот же расчёт, что в /poisk — §3 формула по каждой партии, затем
  // суммирование (null'ы — честно вне суммы, показываем «+»). Числа те же, но
  // входы — SQL-агрегат (плиты любого статуса + куски originSlabId IS NULL),
  // а не row-fetch (par.: src/tests/batch-remainders.test.ts).
  // BUG-03: как и в /poisk, §3 остаток вычитает только РАЗДЕЛЁННЫЕ плиты/бой —
  // объёмная бронь (BATCH_VOLUME) статуса единиц не трогает, поэтому вычитается
  // ОТДЕЛЬНО (getBatchReservationHolds). Иначе карточка показывала бы «свободно 10»
  // там, где /poisk (на клик раньше) уже показал «свободно 8».
  // Единый `now` — и для бронь-фильтра, и для «свежести» фото (TZ §5.3).
  const now = new Date();
  const batchIds = st.batches.map((b) => b.id);
  const [remainders, holds] = await Promise.all([
    getBatchRemainders(db, batchIds),
    getBatchReservationHolds(db, batchIds, now),
  ]);
  const batches = st.batches.map((b) => {
    const free = freeRemainderFromAggregate(
      {
        slabsTotal: b.slabsTotal,
        areaTotalM2: toNum(b.areaTotalM2),
        slabsAdjusted: b.slabsAdjusted,
        areaAdjustedM2: Number(b.areaAdjustedM2),
        slabsSoldDirect: b.slabsSoldDirect,
        areaSoldDirectM2: Number(b.areaSoldDirectM2),
      },
      remainders.get(b.id) ?? EMPTY_AGGREGATE,
    );
    // b.slabs уже отфильтрованы до AVAILABLE в запросе — как в /poisk.
    const availableSlabs = b.slabs;
    return { batch: b, free, availableSlabs };
  });

  // Отдельные бой/остатки в наличии (st.pieces уже AVAILABLE в запросе).
  const availablePieces = st.pieces;

  // BUG-03: slabsTotalSum/areaTotalSum = сумма §3 остатков (до вычета брони);
  // reserved* = сумма активных BATCH_VOLUME-бронь; свободно = max(0, всего − бронь)
  // (АЙНАН как в /poisk, чтобы обе страницы показывали одно и то же число).
  let slabsTotalSum = 0;
  let reservedSlabsSum = 0;
  let slabsKnown = false;
  let slabsUnknown = false;
  let areaTotalSum = 0;
  let reservedAreaSum = 0;
  let areaKnown = false;
  let areaUnknown = false;
  for (const { batch, free } of batches) {
    const hold = holds.get(batch.id) ?? EMPTY_HOLD;
    if (free.slabsFree === null) slabsUnknown = true;
    else {
      slabsKnown = true;
      slabsTotalSum += free.slabsFree;
      reservedSlabsSum += hold.reservedSlabs;
    }
    if (free.areaFreeM2 === null) areaUnknown = true;
    else {
      areaKnown = true;
      areaTotalSum += free.areaFreeM2;
      reservedAreaSum += hold.reservedAreaM2;
    }
  }

  // Свободно = max(0, всего − бронь) — инвариант не даёт уйти в минус.
  const slabsFreeSum = Math.max(0, slabsTotalSum - reservedSlabsSum);
  const areaFreeSum = Math.max(0, areaTotalSum - reservedAreaSum);

  // BUG-03: есть бронь — показываем всего/свободно/в брони (как в /poisk);
  // брони нет — прежний единственный показатель (свободно = всего).
  const totalParts: string[] = [];
  if (slabsKnown)
    totalParts.push(
      reservedSlabsSum > 0
        ? `плит: всего ~${slabsTotalSum}${slabsUnknown ? "+" : ""}, свободно ${slabsFreeSum}, в брони ${reservedSlabsSum}`
        : `плит ~${slabsFreeSum}${slabsUnknown ? "+" : ""}`,
    );
  if (areaKnown)
    totalParts.push(
      reservedAreaSum > 0
        ? `≈${m2Fmt.format(areaTotalSum)} м² всего${areaUnknown ? "+" : ""}, свободно ${m2Fmt.format(areaFreeSum)}, в брони ${m2Fmt.format(reservedAreaSum)}`
        : `≈${m2Fmt.format(areaFreeSum)} м²${areaUnknown ? "+" : ""}`,
    );

  const basePrice = toNum(st.basePrice);
  const propRows = propertyRows(st.properties);
  // `now` определён выше (общий для бронь-фильтра и «свежести» фото, TZ §5.3).
  // Фото → сериализуемые пропсы для клиентского лайтбокса (id/caption/stale).
  // «Свежесть» (TG-C, §5.3) считается на сервере — как и раньше.
  const photoItems: LightboxPhoto[] = st.photos.map((p) => ({
    id: p.id,
    caption: `Снято ${formatTashkentDate(p.takenAt)}`,
    stale: isPhotoStale(p.takenAt, now, photoStaleMonths),
  }));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <Link
        href="/poisk"
        className="text-sm font-medium text-gold-deep hover:underline"
      >
        ← Поиск
      </Link>

      {/* 1. Заголовок */}
      <header className="mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · камень
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          {st.name}
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          {st.rockType}
          {st.color && <> · {st.color}</>}
        </p>
      </header>

      {photoOk && (
        <Alert variant="success" className="mt-4">
          Запрос на фото отправлен складчикам.
        </Alert>
      )}
      {photoNoDelivery && (
        <Alert variant="warning" className="mt-4">
          Запрос сохранён, но пока не доставлен: ни один складчик не подключён к
          Telegram-боту. Он придёт автоматически, как только складчик привяжет
          Telegram (/start у бота).
        </Alert>
      )}
      {photoErr && (
        <Alert variant="danger" className="mt-4">
          {photoErr}
        </Alert>
      )}

      {/* SK-1: результат правки локации (§5.7). */}
      {locOk && (
        <Alert variant="success" className="mt-4">
          Локация обновлена.
        </Alert>
      )}
      {locErr && (
        <Alert variant="danger" className="mt-4">
          {locErr}
        </Alert>
      )}

      {/* SK-2: результат ручной пометки «проверить» (пересорт). */}
      {checkOk && (
        <Alert variant="success" className="mt-4">
          Отметка «проверить» обновлена.
        </Alert>
      )}
      {checkErr && (
        <Alert variant="danger" className="mt-4">
          {checkErr}
        </Alert>
      )}

      {/* 2. Наличие */}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Наличие</h2>
        <p className="mt-1 text-sm text-ink/70">
          {totalParts.length > 0 ? (
            <>
              <span className="font-semibold text-success">Свободно:</span>{" "}
              {totalParts.join(" · ")}
              {(slabsUnknown && !slabsKnown) || (areaUnknown && !areaKnown) ? (
                <NeedsCheckBadge />
              ) : null}
            </>
          ) : (
            <span className="text-ink/50">Нет в наличии (по объёму партий)</span>
          )}
        </p>
        {slabsUnknown && !slabsKnown && (
          <p className="mt-1 text-xs text-ink/55">
            Количество плит неизвестно — партия учтена только в м².
          </p>
        )}

        {/* Отдельные плиты в наличии — как в /poisk (иначе полностью
            разобранная партия читается как «нет в наличии»). */}
        {batches.some((x) => x.availableSlabs.length > 0) && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-ink/70">
              Отдельные плиты
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-ink/70">
              {batches.flatMap(({ availableSlabs }) =>
                availableSlabs.map((s) => (
                  <li key={s.id}>
                    <span className="font-semibold text-ink">{s.label}</span>
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
                    {/* SK-2: пометку «проверить» переключает только склад. */}
                    {caps.canManageWarehouse && (
                      <NeedsCheckToggle
                        entityType="Slab"
                        entityId={s.id}
                        needsCheck={s.needsCheck}
                        backTo={"/kamen/" + id}
                      />
                    )}
                    {/* SK-1b (3): локацию плиты (block/landmark) правит склад. */}
                    {caps.canManageWarehouse && (
                      <SlabLocationForm
                        slabId={s.id}
                        block={s.block}
                        landmark={s.landmark}
                        backTo={"/kamen/" + id}
                      />
                    )}
                  </li>
                )),
              )}
            </ul>
          </div>
        )}

        {/* Бой и остатки в наличии — как в /poisk. */}
        {availablePieces.length > 0 && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-ink/70">Бой и остатки</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-ink/70">
              {availablePieces.map((p) => (
                <li key={p.id}>
                  <span className="font-semibold text-ink">
                    {PIECE_KIND_RU[p.kind] ?? p.kind}
                  </span>{" "}
                  · Габарит {p.boundingLengthMm}×{p.boundingWidthMm} мм
                  {p.thicknessMm !== null && <> · толщина {p.thicknessMm} мм</>}
                  {p.areaM2 !== null && (
                    <> · ≈{m2Fmt.format(Number(p.areaM2))} м²</>
                  )}{" "}
                  · Блок {p.block}, ориентир {p.landmark}
                  {p.needsCheck && <NeedsCheckBadge />}
                  {/* SK-2: пометку «проверить» переключает только склад. */}
                  {caps.canManageWarehouse && (
                    <NeedsCheckToggle
                      entityType="Piece"
                      entityId={p.id}
                      needsCheck={p.needsCheck}
                      backTo={"/kamen/" + id}
                    />
                  )}
                  {/* AI-чертёж (§5.5): data:image/svg+xml URI. Только <img> —
                      без dangerouslySetInnerHTML (SVG рендерится без скриптов).
                      Пусто/нет → ничего не рендерим (без битой картинки). */}
                  {p.drawingUrl && (
                    <img
                      src={p.drawingUrl}
                      alt="Чертёж (размеры)"
                      className="mt-1 block w-full max-w-xs rounded-field border border-ink/10"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* 3. Цена (только basePrice — purchasePrice не показываем) */}
      {/* R2: цену видят только роли с canSeePrices (OWNER/MANAGER), не склад. */}
      {caps.canSeePrices && basePrice !== null && (
        <Card className="mt-4">
          <h2 className="text-lg font-semibold text-ink">Цена</h2>
          <p className="mt-1 text-sm text-ink/70">
            {priceFmt.format(basePrice)} за м²
          </p>
        </Card>
      )}

      {/* 4. Свойства + описание */}
      {(propRows.length > 0 || st.description) && (
        <Card className="mt-4">
          <h2 className="text-lg font-semibold text-ink">Свойства</h2>
          {propRows.length > 0 && (
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {propRows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 text-sm">
                  <dt className="text-ink/55">{k}</dt>
                  <dd className="text-right font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {st.description && (
            <p className="mt-2 whitespace-pre-line text-sm text-ink/70">
              {st.description}
            </p>
          )}
        </Card>
      )}

      {/* 5. Локации */}
      <Card className="mt-4">
        <h2 className="text-lg font-semibold text-ink">Локации</h2>
        {st.batches.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">Партий нет.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {st.batches.map((b) => (
              <li
                key={b.id}
                className="rounded-card border border-ink/10 bg-paper p-3 text-sm"
              >
                <div className="font-semibold text-ink">
                  Партия от {formatTashkentDate(b.arrivedAt)}
                  {b.needsCheck && <NeedsCheckBadge />}
                  {/* SK-2: пометку «проверить» переключает только склад. */}
                  {caps.canManageWarehouse && (
                    <NeedsCheckToggle
                      entityType="Batch"
                      entityId={b.id}
                      needsCheck={b.needsCheck}
                      backTo={"/kamen/" + id}
                    />
                  )}
                </div>
                {b.locations.length === 0 ? (
                  <p className="mt-1 text-ink/50">Локации не указаны.</p>
                ) : (
                  <ul className="mt-1 space-y-2 text-ink/70">
                    {b.locations.map((loc) => (
                      <li key={loc.id}>
                        {/* R2/SK-1: склад (canManageWarehouse) правит локацию
                            инлайн-формой; менеджер/партнёр видят read-only. */}
                        {caps.canManageWarehouse ? (
                          <form
                            action={updateLocation}
                            className="flex flex-wrap items-center gap-1.5"
                          >
                            <input type="hidden" name="locationId" value={loc.id} />
                            <input type="hidden" name="next" value={"/kamen/" + id} />
                            <label className="text-ink/55">Блок</label>
                            <input
                              name="block"
                              defaultValue={loc.block}
                              className={inlineInput + " w-16"}
                            />
                            <label className="text-ink/55">ориентир</label>
                            <input
                              name="landmark"
                              defaultValue={loc.landmark}
                              className={inlineInput + " w-20"}
                            />
                            <input
                              name="note"
                              defaultValue={loc.note ?? ""}
                              placeholder="примечание"
                              className={inlineInput + " w-32"}
                            />
                            {loc.slabsHere !== null && (
                              <span className="text-ink/55">~{loc.slabsHere} плит</span>
                            )}
                            {loc.areaHereM2 !== null && (
                              <span className="text-ink/55">
                                ≈{m2Fmt.format(Number(loc.areaHereM2))} м²
                              </span>
                            )}
                            <Button type="submit" variant="secondary" size="sm">
                              Сохранить
                            </Button>
                          </form>
                        ) : (
                          <>
                            Блок {loc.block}, ориентир {loc.landmark}
                            {loc.slabsHere !== null && <> · ~{loc.slabsHere} плит</>}
                            {loc.areaHereM2 !== null && (
                              <> · ≈{m2Fmt.format(Number(loc.areaHereM2))} м²</>
                            )}
                            {loc.note && (
                              <span className="text-ink/55"> ({loc.note})</span>
                            )}
                          </>
                        )}
                        {/* SK-1b (2): перенос количества A→B — только когда у
                            партии есть куда переносить (≥2 локаций). */}
                        {caps.canManageWarehouse && b.locations.length >= 2 && (
                          <MoveQtyForm
                            sourceId={loc.id}
                            others={b.locations
                              .filter((o) => o.id !== loc.id)
                              .map((o) => ({
                                id: o.id,
                                block: o.block,
                                landmark: o.landmark,
                              }))}
                            backTo={"/kamen/" + id}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/* SK-1b (1): добавить новую локацию к партии — только склад. */}
                {caps.canManageWarehouse && (
                  <AddLocationForm batchId={b.id} backTo={"/kamen/" + id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 6. Фото — вечное хранение + дата съёмки и «свежесть» (TZ §5.3) */}
      <Card className="mt-4">
        <h2 className="text-lg font-semibold text-ink">Фото</h2>
        {photoItems.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">Фото пока нет.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink/55">
              Фото уже есть — склад повторно не снимаем.
            </p>
            {/* Клиентский лайтбокс: клик по миниатюре → фото во весь экран.
                Миниатюры и прокси /api/photo/[id] — без изменений. */}
            <PhotoLightbox photos={photoItems} />
          </>
        )}
      </Card>

      {/* 7. Запросить фото — по каждой локации, либо по партии целиком */}
      {/* R2: запрос фото — только роли с canRequestPhoto (OWNER/MANAGER). */}
      {caps.canRequestPhoto && st.batches.length > 0 && (
        <Card className="mt-4">
          <h2 className="text-lg font-semibold text-ink">Запросить фото</h2>
          <ul className="mt-2 space-y-2">
            {st.batches.map((b) => (
              <li key={b.id} className="text-sm">
                <div className="text-ink/60">
                  Партия от {formatTashkentDate(b.arrivedAt)}
                </div>
                {b.locations.length === 0 ? (
                  <form action={requestPhoto} className="mt-1">
                    <input type="hidden" name="batchId" value={b.id} />
                    <input type="hidden" name="next" value={"/kamen/" + id} />
                    <Button type="submit" variant="secondary" size="sm">
                      <CameraIcon width={16} height={16} />
                      Запросить фото
                    </Button>
                  </form>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {b.locations.map((loc) => (
                      <li key={loc.id}>
                        <form
                          action={requestPhoto}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="batchId" value={b.id} />
                          <input
                            type="hidden"
                            name="batchLocationId"
                            value={loc.id}
                          />
                          <input type="hidden" name="next" value={"/kamen/" + id} />
                          <span className="text-ink/70">
                            Блок {loc.block}, ориентир {loc.landmark}
                          </span>
                          <Button type="submit" variant="secondary" size="sm">
                            <CameraIcon width={16} height={16} />
                            Запросить фото
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
