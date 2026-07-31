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
import { getCapabilities, getRealSessionUser } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import { recordPassiveView } from "@/lib/leads";
import { requestPhoto } from "@/app/poisk/actions";
import { requestLead } from "./lead-actions";
import {
  addLocation,
  editStoneType,
  generateInteriors,
  moveQty,
  setNeedsCheck,
  updateLocation,
  updateSlabLocation,
} from "@/app/kamen/actions";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import {
  clampPatternRemainder,
  patternStatus,
  PATTERN_STATUS_RU,
} from "@/lib/pattern-status";
import Button from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { CameraIcon } from "@/components/ui/Icons";
import SharePhotoButton from "@/components/SharePhotoButton";
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
  // A1 (§6.8): результат запроса объёма партнёром (лид создан / ошибка поля).
  const leadOk = firstParam(sp.lead) === "ok";
  const leadErr = firstParam(sp.leadErr);
  // OWN-02: результат правки карточки камня владельцем.
  const cardOk = firstParam(sp.cardOk) === "1";
  const cardErr = firstParam(sp.cardErr);
  // §6.7 «B»: результат генерации AI-интерьеров.
  const aiOk = firstParam(sp.aiOk);
  const aiErr = firstParam(sp.aiErr);

  // R2 — rol gate: наличие/фото/локации видит и склад, а вот цену (canSeePrices)
  // и «Запросить фото» (§7, canRequestPhoto) — только соответствующие роли.
  // getCapabilities() — в общий Promise.all, чтобы не добавлять лишний
  // последовательный round-trip на самой горячей странице.
  const [st, photoCfg, caps, me, interiors] = await Promise.all([
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
        // §6.7 — публичная QR-ссылка шоу-рума (/q/[slug]).
        qrSlug: true,
        basePrice: true,
        // §5.8: закупочная цена — видна только canSeePurchasePrice (OWNER;
        // менеджер — по явному разрешению). Тянем всегда, показываем по caps ниже.
        purchasePrice: true,
        // A1 (§6.8): файл-текстура вида — партнёр/дизайнер её скачивает.
        textureFileUrl: true,
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
            // ТЗ №3 — узор-подгруппы партии + их фото (образец узора, kind SAMPLE).
            // Для B2C: менеджер показывает клиенту конкретный узор с готовым фото.
            patterns: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                description: true,
                thicknessMm: true,
                slabsCount: true,
                areaM2: true,
                slabsSold: true,
                areaSoldM2: true,
                photos: {
                  select: { id: true, takenAt: true },
                  orderBy: { createdAt: "desc" },
                  take: 4,
                },
              },
            },
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
                // On-demand separation (§6.1): у выделенной плиты — своё фото
                // (Photo.slabId). Показываем миниатюры под ярлыком, чтобы менеджер/
                // клиент видел «Плита №N + её фото». take:4 — не тянем весь хвост.
                photos: {
                  select: { id: true },
                  orderBy: { createdAt: "desc" },
                  take: 4,
                },
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
    // OWN-02: реальная сессия — правку карточки показываем только OWNER.
    getRealSessionUser(),
    // §6.7 «B»: AI-интерьеры вида (отдельный блок + галерея на /q).
    db.photo.findMany({
      where: { stoneTypeId: id, kind: "INTERIOR_AI" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);
  const isOwner = me?.role === "OWNER";
  // §6.7 «B»: интерьеры генерируют OWNER/MANAGER (стоит денег — B2C-маркетинг).
  const canGenAI = me?.role === "OWNER" || me?.role === "MANAGER";
  // TZ §5.3: фото старше N месяцев → пометка «возможно, переснять» (default 6).
  const photoStaleMonths = parsePhotoStaleMonthsConfig(photoCfg?.value);

  // W8-A / §6.8.5 — passive interest: identified PARTNER opened this stone card.
  // One call per navigation (not per list tile). No anonymous / non-PARTNER.
  // Failures must not break the card (manager queue is secondary to browsing).
  if (st && me?.role === "PARTNER") {
    try {
      await recordPassiveView(db, {
        createdById: me.id,
        stoneTypeId: st.id,
      });
    } catch (err) {
      console.error("[kamen] recordPassiveView:", err);
    }
  }

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
  // Аудит ТЗ №7 #20 — узор-остаток на дисплее clamp'ится по свободному остатку
  // партии; здесь готовим карту batchId → free, чтобы использовать в render'е.
  const batchFreeMap = new Map(batches.map((x) => [x.batch.id, x.free]));

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

  // §6.7: клиент/партнёр (без canSeeExactRemainder) НЕ видит точных остатков,
  // ярлыков плит и локаций — только нейтральный признак «в наличии / нет».
  // Наличие есть, если СВОБОДНЫЙ §3-объём > 0 ЛИБО остались отдельные плиты/бой
  // (партия может быть полностью разобрана — объём 0, но отдельные единицы есть).
  // Опираемся на СВОБОДНЫЙ остаток (не на «известность» тотала), чтобы полностью
  // проданный камень показывался как «нет в наличии» — паритет с /poisk.
  const hasStock =
    slabsFreeSum > 0 ||
    areaFreeSum > 0 ||
    batches.some((x) => x.availableSlabs.length > 0) ||
    availablePieces.length > 0;

  const basePrice = toNum(st.basePrice);
  // §5.8: закупочная цена + маржа — только для canSeePurchasePrice (OWNER;
  // менеджер — лишь если явно разрешено User.canSeePurchasePrice). Маржа =
  // продажная − закупочная, считается только когда известны ОБЕ цены.
  const purchasePrice = toNum(st.purchasePrice);
  const margin =
    basePrice !== null && purchasePrice !== null
      ? basePrice - purchasePrice
      : null;
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
        <div className="mt-2 flex items-center gap-4">
          {/* Монограмма по породе — тот же якорь, что в карточках поиска
              (визуально связывает список → деталь). */}
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gold/12 font-serif text-2xl font-bold text-gold-deep"
          >
            {(st.rockType || st.name).trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="font-serif text-display font-bold tracking-tight text-ink">
              {st.name}
            </h1>
            <p className="mt-1 text-sm text-ink/60">
              {st.rockType}
              {st.color && <> · {st.color}</>}
            </p>
          </div>
        </div>
        {/* A1 (§6.8): файл-текстура вида — скачивание доступно всем (партнёр
            подбирает камень по текстуре). Показываем только когда файл задан. */}
        {st.textureFileUrl && (
          <a
            href={st.textureFileUrl}
            target="_blank"
            rel="noreferrer"
            download
            className="mt-2 inline-block text-sm font-medium text-gold-deep hover:underline"
          >
            Скачать файл (текстура)
          </a>
        )}
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

      {/* A1 (§6.8): результат запроса объёма партнёром. */}
      {leadOk && (
        <Alert variant="success" className="mt-4">
          Заявка принята — менеджер свяжется с вами.
        </Alert>
      )}
      {leadErr && (
        <Alert variant="danger" className="mt-4">
          {leadErr}
        </Alert>
      )}
      {/* OWN-02: результат правки карточки. */}
      {cardOk && (
        <Alert variant="success" className="mt-4">
          Карточка обновлена.
        </Alert>
      )}
      {cardErr && (
        <Alert variant="danger" className="mt-4">
          {cardErr === "denied"
            ? "Недостаточно прав (правит только владелец)."
            : cardErr === "name_taken"
              ? "Камень с таким названием уже есть."
              : cardErr === "name"
                ? "Укажите название."
                : cardErr === "rockType"
                  ? "Укажите породу."
                  : cardErr === "basePrice"
                    ? "Некорректная цена продажи."
                    : cardErr === "purchasePrice"
                      ? "Некорректная закупочная цена."
                      : "Не удалось сохранить карточку."}
        </Alert>
      )}

      {/* OWN-02 (ТЗ №2) — редактирование карточки: ТОЛЬКО владелец. Свёрнуто,
          чтобы не мешать обычному просмотру. */}
      {isOwner && (
        <details className="mt-4 rounded-card border border-line bg-paper-2 p-4">
          <summary className="cursor-pointer font-semibold text-ink">
            Редактировать карточку
          </summary>
          <form
            action={editStoneType}
            className="mt-4 flex flex-col gap-3"
          >
            <input type="hidden" name="stoneTypeId" value={st.id} />
            <input type="hidden" name="next" value={`/kamen/${st.id}`} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Название</span>
              <input
                name="name"
                defaultValue={st.name}
                required
                className={inputClass}
              />
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-ink/70">Порода</span>
                <input
                  name="rockType"
                  defaultValue={st.rockType}
                  required
                  className={inputClass}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-ink/70">Цвет</span>
                <input
                  name="color"
                  defaultValue={st.color ?? ""}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-ink/70">Цена продажи (за м²)</span>
                <input
                  name="basePrice"
                  inputMode="decimal"
                  defaultValue={basePrice ?? ""}
                  placeholder="напр. 95"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-ink/70">Закупочная цена (за м²)</span>
                <input
                  name="purchasePrice"
                  inputMode="decimal"
                  defaultValue={purchasePrice ?? ""}
                  placeholder="напр. 60"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Описание</span>
              <textarea
                name="description"
                defaultValue={st.description ?? ""}
                rows={2}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">
                Свойства — по строке «ключ: значение»
              </span>
              <textarea
                name="properties"
                defaultValue={propRows.map(([k, v]) => `${k}: ${v}`).join("\n")}
                rows={3}
                placeholder={"finish: полированный\norigin: Турция"}
                className={inputClass}
              />
            </label>
            <Button type="submit" className="w-full sm:w-auto">
              Сохранить карточку
            </Button>
          </form>
        </details>
      )}

      {/* §6.7 — публичная QR-ссылка для шоу-рума. Все, кто открыл /kamen, —
          сотрудники (страница за login-gate), поэтому показываем всем им. */}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-ink">QR для шоу-рума</h2>
        <p className="mt-1 text-sm text-ink/60">
          Публичная страница вида камня — для клиента (без остатков и цен).
          Разместите QR на образце: ссылка открывает эту карточку.
        </p>
        <Link
          href={`/q/${st.qrSlug}`}
          target="_blank"
          className="mt-2 inline-block break-all font-medium text-gold-deep underline"
        >
          /q/{st.qrSlug}
        </Link>
      </Card>

      {/* §6.7 «B» — AI-интерьеры камня (генерирует OWNER/MANAGER по фото). */}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Интерьеры (AI)</h2>
        <p className="mt-1 text-sm text-ink/60">
          Как этот камень смотрится в интерьере — ресепшен, ванная, гостиная.
          Клиент видит их на QR-странице.
        </p>
        {aiOk && (
          <Alert variant="success" className="mt-3">
            Готово: сгенерировано интерьеров — {aiOk}.
          </Alert>
        )}
        {aiErr && (
          <Alert variant="danger" className="mt-3">
            {aiErr === "nophoto"
              ? "Нужно хотя бы одно фото камня (образец/плита) — по нему рисуем интерьеры."
              : aiErr === "denied"
                ? "Недостаточно прав (генерируют владелец/менеджер)."
                : aiErr.startsWith("failed:")
                  ? `Не удалось сгенерировать. Причина: ${aiErr.slice(7)}`
                  : aiErr === "failed"
                    ? "Не удалось сгенерировать — попробуйте позже."
                    : "Не удалось выполнить."}
          </Alert>
        )}
        {interiors.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {interiors.map((p) => (
              <a
                key={p.id}
                href={`/api/photo/${p.id}`}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photo/${p.id}`}
                  alt="AI-интерьер"
                  loading="lazy"
                  className="aspect-square w-full rounded-card object-cover"
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink/40">Интерьеры ещё не созданы.</p>
        )}
        {canGenAI && (
          <form action={generateInteriors} className="mt-3">
            <input type="hidden" name="stoneTypeId" value={st.id} />
            <Button type="submit" variant="secondary" size="sm">
              {interiors.length > 0
                ? "Перегенерировать интерьеры"
                : "Сгенерировать интерьеры"}
            </Button>
          </form>
        )}
      </Card>

      {/* 2. Наличие */}
      {/* §6.7: точные остатки/ярлыки плит/локации видят только роли с
          canSeeExactRemainder (OWNER/MANAGER/WAREHOUSE). Партнёр/клиент видит
          лишь нейтральный признак «в наличии», без чисел и без локаций. */}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Наличие</h2>
        {!caps.canSeeExactRemainder ? (
          <p className="mt-1 text-sm text-ink/70">
            {hasStock ? (
              <span className="font-semibold text-success">В наличии</span>
            ) : (
              <span className="text-ink/50">Нет в наличии</span>
            )}
          </p>
        ) : (
        <>
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
                    {/* §6.1 шаг 8: клиент выбрал плиту №N → продажа с preselect.
                        ?slab=<id> — /prodazha server-side tekshiradi (SOLD/чужая
                        бронь/yo'q). Faqat canSell + !needsCheck (AVAILABLE filter). */}
                    {caps.canSell && !s.needsCheck && (
                      <Link
                        href={"/prodazha?slab=" + encodeURIComponent(s.id)}
                        className="ml-2 inline-block align-middle text-sm font-medium text-gold-deep hover:underline"
                      >
                        Купить ({s.label})
                      </Link>
                    )}
                    {/* SK-2: пометку «проверить» переключает только склад. */}
                    {caps.canManageWarehouse && (
                      <NeedsCheckToggle
                        entityType="Slab"
                        entityId={s.id}
                        needsCheck={s.needsCheck}
                        backTo={"/kamen/" + id}
                      />
                    )}
                    {/* §6.1: фото выделенной плиты (Photo.slabId) — миниатюры под
                        ярлыком. Прокси /api/photo/[id] (тот же, что у галереи).
                        Клик открывает полный размер в новой вкладке. Нет фото —
                        subtle «без фото» (частая ситуация до первой съёмки).
                        §6.1 шаг 7: canSell — «Клиенту» (Web Share / копия ссылки);
                        URL открытый и отдаёт только байты картинки (см. api/photo). */}
                    {s.photos.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.photos.map((ph) => (
                          <div key={ph.id} className="flex w-16 flex-col gap-0.5">
                            <a
                              href={"/api/photo/" + ph.id}
                              target="_blank"
                              rel="noreferrer"
                              className="block h-16 w-16 overflow-hidden rounded-field border border-ink/10"
                            >
                              <img
                                src={"/api/photo/" + ph.id}
                                alt={"Фото — " + s.label}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            </a>
                            {caps.canSell && (
                              <SharePhotoButton
                                photoId={ph.id}
                                title={`${st.name} — ${s.label}`}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="ml-2 align-middle text-xs text-ink/40">
                        без фото
                      </span>
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
        </>
        )}
      </Card>

      {/* 3. Цена */}
      {/* R2: продажную цену видят роли с canSeePrices (OWNER/MANAGER), не склад.
          §5.8: закупочную цену и маржу — только canSeePurchasePrice (OWNER;
          менеджер лишь по явному разрешению). Карточка показывается, если есть
          хотя бы одна доступная пользователю цена. */}
      {((caps.canSeePrices && basePrice !== null) ||
        (caps.canSeePurchasePrice && purchasePrice !== null)) && (
        <Card className="mt-4">
          <h2 className="text-lg font-semibold text-ink">Цена</h2>
          {caps.canSeePrices && basePrice !== null && (
            <p className="mt-1 text-sm text-ink/70">
              <span className="text-ink/55">Продажная:</span>{" "}
              {priceFmt.format(basePrice)} за м²
            </p>
          )}
          {/* §5.8: закупочная + маржа — строго под canSeePurchasePrice, поэтому
              менеджер без разрешения (canSeePurchasePrice=false) их НЕ видит. */}
          {caps.canSeePurchasePrice && purchasePrice !== null && (
            <p className="mt-1 text-sm text-ink/70">
              <span className="text-ink/55">Закупочная:</span>{" "}
              {priceFmt.format(purchasePrice)} за м²
            </p>
          )}
          {/* Маржа = продажная − закупочная → раскрывает продажную. Поэтому
              строго под ОБОИМИ флагами (defense-in-depth): без canSeePrices
              маржа не должна утечь базовую цену. */}
          {caps.canSeePrices && caps.canSeePurchasePrice && margin !== null && (
            <p className="mt-1 text-sm text-ink/70">
              <span className="text-ink/55">Маржа:</span>{" "}
              {priceFmt.format(margin)} за м²
            </p>
          )}
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
      {/* §6.7: физические локации (блок/ориентир) — складская информация;
          скрыта от партнёра/клиента (без canSeeExactRemainder). */}
      {caps.canSeeExactRemainder && (
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

                {/* ТЗ №3 — узоры партии с фото (B2C: предложить клиенту узор). */}
                {b.patterns.length > 0 && (() => {
                  // Аудит ТЗ №7 #20 — clamp узор-остатка по свободному остатку партии.
                  const batchFree = batchFreeMap.get(b.id) ?? {
                    slabsFree: null,
                    areaFreeM2: null,
                  };
                  return (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gold-deep">
                      Узоры в партии
                    </p>
                    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {b.patterns.map((pat) => (
                        <li
                          key={pat.id}
                          className="rounded-card border border-line bg-paper-2 p-2"
                        >
                          {pat.photos.length > 0 ? (
                            <>
                              <a
                                href={"/api/photo/" + pat.photos[0].id}
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={"/api/photo/" + pat.photos[0].id}
                                  alt={"Узор: " + pat.description}
                                  loading="lazy"
                                  className="mb-1 aspect-square w-full rounded-lg object-cover"
                                />
                              </a>
                              {/* TZ §5.3 — дата съёмки узора + «свежесть». */}
                              <p className="mb-1.5 text-[11px] text-ink/45">
                                Снято {formatTashkentDate(pat.photos[0].takenAt)}
                              </p>
                              {isPhotoStale(
                                pat.photos[0].takenAt,
                                now,
                                photoStaleMonths,
                              ) && (
                                <p className="mb-1.5 text-[11px] font-medium text-gold-deep">
                                  возможно, переснять
                                </p>
                              )}
                            </>
                          ) : (
                            <div className="mb-1.5 flex aspect-square w-full items-center justify-center rounded-lg bg-ink/[0.04] text-center text-xs text-ink/40">
                              фото ожидается
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold text-ink">
                              {pat.description}
                            </p>
                            {/* ТЗ №3 §2 — статус подгруппы (из остатка): узор
                                может быть продан, пока в партии есть другие. */}
                            {(() => {
                              const st = patternStatus({
                                slabsCount: pat.slabsCount,
                                slabsSold: pat.slabsSold,
                                areaM2: Number(pat.areaM2),
                                areaSoldM2: Number(pat.areaSoldM2),
                              });
                              const variant =
                                st === "AVAILABLE"
                                  ? "success"
                                  : st === "PARTIAL"
                                    ? "warning"
                                    : "neutral";
                              return (
                                <Badge variant={variant}>
                                  {PATTERN_STATUS_RU[st]}
                                </Badge>
                              );
                            })()}
                          </div>
                          {(() => {
                            // Аудит ТЗ №7 #20 — clamp по свободному остатку партии.
                            const clamped = clampPatternRemainder(
                              {
                                slabsCount: pat.slabsCount,
                                slabsSold: pat.slabsSold,
                                areaM2: Number(pat.areaM2),
                                areaSoldM2: Number(pat.areaSoldM2),
                              },
                              batchFree,
                            );
                            return (
                              <p className="tnum text-xs text-ink/60">
                                {pat.thicknessMm !== null && <>{pat.thicknessMm} мм · </>}
                                осталось {clamped.slabsRemaining} плит ·{" "}
                                {m2Fmt.format(clamped.areaRemainingM2)} м²
                              </p>
                            );
                          })()}
                          {pat.slabsSold > 0 && (
                            <p className="tnum text-xs text-ink/40">
                              продано {pat.slabsSold} из {pat.slabsCount}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}

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

      {/* 8. Запросить объём (A1, TZ §6.8) — партнёрский флоу. Только PARTNER
          (requestsRouteToManager): OWNER/MANAGER продают напрямую. Каждый запрос
          → Lead(NEW) для менеджера, «ни один интерес не теряется» (§6.8.5). */}
      {caps.requestsRouteToManager && (
        <Card className="mt-4">
          <h2 className="text-lg font-semibold text-ink">Запросить объём</h2>
          <p className="mt-1 text-sm text-ink/60">
            Оставьте запрос — менеджер свяжется с вами и подберёт камень под проект.
          </p>
          <form action={requestLead} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="stoneTypeId" value={st.id} />
            <input type="hidden" name="next" value={"/kamen/" + id} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-ink/55">Плиты</label>
              <input
                name="requestedSlabs"
                inputMode="numeric"
                placeholder="напр. 10"
                className={inlineInput + " w-24"}
              />
              <label className="text-sm text-ink/55">м²</label>
              <input
                name="requestedAreaM2"
                inputMode="decimal"
                placeholder="напр. 12,5"
                className={inlineInput + " w-24"}
              />
            </div>
            <input
              name="contact"
              placeholder="Ваш контакт (телефон / Telegram)"
              className={inlineInput + " w-full sm:max-w-sm"}
            />
            <textarea
              name="note"
              placeholder="Комментарий (проект, сроки, пожелания)"
              rows={2}
              className={inlineInput + " w-full sm:max-w-sm"}
            />
            <Button type="submit" variant="secondary" size="sm" className="w-full sm:w-auto">
              Отправить запрос
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
