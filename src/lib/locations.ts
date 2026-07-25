// SK-1 — Локация партии (BatchLocation) правка/перемещение: TZ §5.7
// «отметить/изменить локацию». Складчик меняет block/landmark (и note) у уже
// существующей локации — это записывается как аудит MOVE. Здесь — ЧИСТЫЕ (без DB,
// без next, без new Date()) хелперы: валидация ввода и сборка delta-payload'а
// для MOVE. UI ga bog'liq narsa yo'q — bu funksiyalar server action'dan ham,
// kelajakdagi Telegram botdan ham chaqirilishi mumkin va alohida unit-testlanadi.
//
// SK-1b — реализовано ниже (отдельные чистые хелперы): добавление НОВОЙ локации
// (validateNewLocation), перенос количества между локациями одной партии
// (validateQtyMove) и локация на уровне плиты (validateSlabLocation).

import { normalizeBlockLetter } from "@/lib/block-letter";
import { parsePositiveDecimal, parsePositiveInt } from "@/lib/validators/intake";

// ──────────────────── Sof helperlar (DB YO'Q — unit-test) ────────────────────

/** Локация после нормализации: block/landmark непусты, note → строка или null. */
export interface NormalizedLocation {
  block: string;
  landmark: string;
  note: string | null;
}

export interface LocationEditInput {
  block: string;
  landmark: string;
  note?: string | null;
}

export type ValidateLocationResult =
  | { ok: true; data: NormalizedLocation }
  | { ok: false; error: string };

/**
 * Правка локации: block и landmark — обязательны (после trim непусты), note —
 * необязателен (пустой/пробельный → null). Сообщения — русские (язык UI),
 * согласованы с остальными валидаторами. Сама строка НЕ мутируется — возвращаем
 * тримленные значения в data.
 */
export function validateLocationEdit(
  input: LocationEditInput,
): ValidateLocationResult {
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр буквы блока (кир/лат дубли).
  const block = normalizeBlockLetter(input.block);
  if (!block) return { ok: false, error: "Укажите блок" };

  const landmark = input.landmark.trim();
  if (!landmark) return { ok: false, error: "Укажите ориентир" };

  const note = input.note?.trim() || null;

  return { ok: true, data: { block, landmark, note } };
}

/**
 * Delta-payload для аудита MOVE: сравниваем before/after и складываем в
 * self-описывающую структуру `{ from: {...}, to: {...} }`, где показаны ТОЛЬКО
 * изменённые поля (block/landmark/note). Если ничего не поменялось — обе стороны
 * пустые ({}), что тоже честно фиксирует «MOVE без фактических изменений».
 * Чистая функция: никакого DB/времени внутри.
 */
export function buildMovePayload(
  before: NormalizedLocation,
  after: NormalizedLocation,
): Record<string, unknown> {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};

  (["block", "landmark", "note"] as const).forEach((field) => {
    if (before[field] !== after[field]) {
      from[field] = before[field];
      to[field] = after[field];
    }
  });

  return { from, to };
}

/**
 * MOVE-payload'да реальных изменений НЕТ? (пустая дельта `{from:{},to:{}}`).
 * Server action использует это, чтобы не писать бессмысленный аудит MOVE и не
 * трогать строку, когда «Сохранить» нажали без правок. Читаемо и тестируемо.
 */
export function isNoopMove(payload: Record<string, unknown>): boolean {
  const from = payload.from;
  return (
    from == null ||
    typeof from !== "object" ||
    Object.keys(from as Record<string, unknown>).length === 0
  );
}

// ─────────────── SK-1b (1): добавление НОВОЙ локации к партии ────────────────

/** Нормализованная новая локация: block/landmark непусты; qty — число или null. */
export interface NormalizedNewLocation {
  block: string;
  landmark: string;
  slabsHere: number | null;
  areaHereM2: number | null;
  note: string | null;
}

/** Сырой ввод формы: qty — строки («40», «12,5», ""), парсим тем же слоем. */
export interface NewLocationInput {
  block: string;
  landmark: string;
  slabsHere?: string | null;
  areaHereM2?: string | null;
  note?: string | null;
}

export type ValidateNewLocationResult =
  | { ok: true; data: NormalizedNewLocation }
  | { ok: false; error: string };

/**
 * Добавление локации к партии: block/landmark — обязательны (те же русские
 * сообщения, что у правки — «Укажите блок»/«Укажите ориентир»). slabsHere и
 * areaHereM2 — НЕОБЯЗАТЕЛЬНЫ: пусто → null; заданы → парсятся через общий слой
 * приёмки (parsePositiveInt/parsePositiveDecimal, поддержка «12,5» и верхние
 * пределы под Int4/Decimal(12,3)); неверное/отрицательное/переполнение →
 * ошибка. note — необязателен (пустой/пробельный → null). Чистая функция.
 */
export function validateNewLocation(
  input: NewLocationInput,
): ValidateNewLocationResult {
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр буквы блока (кир/лат дубли).
  const block = normalizeBlockLetter(input.block);
  if (!block) return { ok: false, error: "Укажите блок" };

  const landmark = input.landmark.trim();
  if (!landmark) return { ok: false, error: "Укажите ориентир" };

  const slabsHere = parsePositiveInt(input.slabsHere ?? "");
  if (slabsHere === undefined) {
    return { ok: false, error: "Число плит — целое положительное число" };
  }

  const areaHereM2 = parsePositiveDecimal(input.areaHereM2 ?? "");
  if (areaHereM2 === undefined) {
    return { ok: false, error: "Площадь — положительное число, например 12,5" };
  }

  const note = input.note?.trim() || null;

  return { ok: true, data: { block, landmark, slabsHere, areaHereM2, note } };
}

// ────────── SK-1b (2): перенос количества между локациями (A→B) ──────────────

/** Нормализованный объём переноса: минимум одно из полей — положительное. */
export interface NormalizedQtyMove {
  qtySlabs: number | null;
  qtyAreaM2: number | null;
}

/** Сырой ввод переноса — строки формы. */
export interface QtyMoveInput {
  qtySlabs?: string | null;
  qtyAreaM2?: string | null;
}

/** Наличие в источнике (свежечитанная строка BatchLocation) — против чего сверяем. */
export interface QtyMoveSource {
  slabsHere: number | null;
  areaHereM2: number | null;
}

export type ValidateQtyMoveResult =
  | { ok: true; data: NormalizedQtyMove }
  | { ok: false; error: string };

/**
 * Перенос количества A→B в пределах ОДНОЙ партии. BatchLocation.slabsHere/
 * areaHereM2 — это физическое распределение, а НЕ вход формулы свободного
 * остатка §3 (batch totals − sold − adjusted), поэтому batch-lock ADR-007 здесь
 * не нужен: перенос remainder-нейтрален. Но локация не должна уйти в минус —
 * это проверяем против СВЕЖЕ прочитанного источника (в action под FOR UPDATE).
 *
 * Правила: хотя бы одно из qtySlabs/qtyAreaM2 — положительное число (иначе
 * «Укажите количество для переноса»); если задано qtySlabs — в источнике должно
 * быть неnull и ≥ qtySlabs («Недостаточно плит в источнике»); аналогично площадь
 * («Недостаточно площади в источнике»). Неверный формат числа → ошибка формата.
 */
export function validateQtyMove(
  input: QtyMoveInput,
  source: QtyMoveSource,
): ValidateQtyMoveResult {
  const qtySlabs = parsePositiveInt(input.qtySlabs ?? "");
  if (qtySlabs === undefined) {
    return { ok: false, error: "Число плит — целое положительное число" };
  }

  const qtyAreaM2 = parsePositiveDecimal(input.qtyAreaM2 ?? "");
  if (qtyAreaM2 === undefined) {
    return { ok: false, error: "Площадь — положительное число, например 12,5" };
  }

  if (qtySlabs === null && qtyAreaM2 === null) {
    return { ok: false, error: "Укажите количество для переноса" };
  }

  if (qtySlabs !== null) {
    if (source.slabsHere === null || source.slabsHere < qtySlabs) {
      return { ok: false, error: "Недостаточно плит в источнике" };
    }
  }

  if (qtyAreaM2 !== null) {
    if (source.areaHereM2 === null || source.areaHereM2 < qtyAreaM2) {
      return { ok: false, error: "Недостаточно площади в источнике" };
    }
  }

  return { ok: true, data: { qtySlabs, qtyAreaM2 } };
}

// ───────────────── SK-1b (3): локация на уровне ПЛИТЫ (Slab) ─────────────────

/** У Slab только block/landmark (обязательны), поля note НЕТ (schema). */
export interface SlabLocation {
  block: string;
  landmark: string;
}

export type ValidateSlabLocationResult =
  | { ok: true; data: SlabLocation }
  | { ok: false; error: string };

/**
 * Правка локации плиты: block/landmark — обязательны (те же русские сообщения).
 * Переиспользуем validateLocationEdit (без note) и отдаём только block/landmark,
 * чтобы не дублировать правила валидации. Чистая функция.
 */
export function validateSlabLocation(
  input: SlabLocation,
): ValidateSlabLocationResult {
  const r = validateLocationEdit({ block: input.block, landmark: input.landmark });
  if (!r.ok) return r;
  return { ok: true, data: { block: r.data.block, landmark: r.data.landmark } };
}
