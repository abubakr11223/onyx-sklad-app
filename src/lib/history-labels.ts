// Русские подписи журнала действий (/istoriya). Чистый модуль без БД и Next —
// вынесен из страницы, чтобы `src/tests/history-labels.test.ts` мог сверять его
// с `AuditAction` в схеме Prisma.
//
// Зачем сверка. ТЗ №15 §7.9 требует «все действия в Истории». Формально это
// выполнялось: SHIPMENT_CONFIRM, SHOWROOM_SEND и SAMPLE_* писались в AuditLog.
// Но подписи для них не было, и журнал показывал сырой enum — читать его было
// нельзя. Ошибка тихая: новый член enum'а ничего не ломает, просто появляется
// английское слово в русском интерфейсе. Тест закрывает именно этот зазор.

/** AuditAction (schema §1.10) → русская подпись действия. */
export const ACTION_RU: Record<string, string> = {
  INTAKE: "Приёмка",
  SALE: "Продажа",
  RESERVE: "Бронь",
  RESERVE_CANCEL: "Снятие брони",
  RESERVE_EXPIRE: "Бронь истекла",
  SEPARATE_SLAB: "Выделение плиты",
  BREAK: "Разбитие",
  SPLIT: "Разделение",
  MOVE: "Перемещение",
  PHOTO_REQUEST: "Фотозапрос",
  PHOTO_UPLOAD: "Загрузка фото",
  RETURN: "Возврат",
  ADJUSTMENT: "Корректировка",
  STATUS_CHANGE: "Смена статуса",
  // ТЗ №10 (образцы) и ТЗ №15 §7.9 (отгрузки, шоу-рум).
  SAMPLE_ISSUE: "Выдача образца",
  SAMPLE_RETURN: "Возврат образца",
  SAMPLE_SELL: "Продажа образца",
  SAMPLE_EXTEND: "Продление образца",
  SHIPMENT_CONFIRM: "Отгрузка",
  SHOWROOM_SEND: "В шоу-рум",
  SHOWROOM_RETURN: "Возврат из шоу-рума",
  // Аудит 2026-09-02 — системные действия (userId = null). Показываются в
  // Истории наравне с остальными: на вопрос «а копии вообще делаются?»
  // ответ должен быть виден в приложении, а не только в логах хостинга.
  BACKUP: "Резервная копия",
  EXPORT: "Выгрузка базы",
};

/** AuditLog.entityType (свободная строка «Batch»/«Slab»/…) → русская подпись. */
export const ENTITY_RU: Record<string, string> = {
  Backup: "Резервная копия",
  Batch: "Партия",
  Slab: "Плита",
  Piece: "Бой/остаток",
  BatchLocation: "Локация",
  Reservation: "Бронь",
  StoneType: "Вид камня",
  // ТЗ №9/№10/№11/№15 — сущности, появившиеся после первой версии Истории.
  Sample: "Образец",
  Shipment: "Отгрузка",
  ShowroomPlacement: "Шоу-рум",
  Client: "Клиент",
  Site: "Объект",
  Debt: "Долг",
  User: "Сотрудник",
};

export type HistoryBadgeVariant = "success" | "warning" | "danger" | "neutral";

/** Действия, где badge несёт «настроение» (продажа — успех, разбитие — риск). */
export const ACTION_VARIANT: Record<string, HistoryBadgeVariant> = {
  SALE: "success",
  RESERVE: "success",
  BREAK: "warning",
  SPLIT: "warning",
  RESERVE_EXPIRE: "warning",
  RESERVE_CANCEL: "neutral",
  RETURN: "warning",
  ADJUSTMENT: "warning",
  SAMPLE_ISSUE: "warning", // камень ушёл со склада, но не продан — держим на виду
  SAMPLE_RETURN: "success",
  SAMPLE_SELL: "success",
  SHIPMENT_CONFIRM: "success",
  SHOWROOM_SEND: "warning",
  SHOWROOM_RETURN: "success",
  BACKUP: "success",
  // Выгрузка всей базы — редкое и крупное действие: держим на виду,
  // чтобы чужая строчка в журнале сразу бросалась в глаза.
  EXPORT: "warning",
};

/** Подпись действия; неизвестное — как есть (лучше сырой код, чем пустота). */
export function actionLabelRu(action: string): string {
  return ACTION_RU[action] ?? action;
}

/** Подпись сущности; неизвестная — как есть. */
export function entityLabelRu(entityType: string): string {
  return ENTITY_RU[entityType] ?? entityType;
}

/** Вариант badge; по умолчанию нейтральный. */
export function actionVariant(action: string): HistoryBadgeVariant {
  return ACTION_VARIANT[action] ?? "neutral";
}

// ───────────────────── ТЗ №19 E2 — содержание записи ─────────────────────
//
// «Отгрузка #cmvhvsy1» не говорит, что и сколько. Журнал — инструмент контроля
// (ТЗ №14 §3.2: правка количества — чувствительная операция), поэтому каждая
// строка показывает объект, количество, узор, локацию, а правки — «было → стало».
// Формат: «Травертин Классик · 6 пл. / 24,69 м² · 2 узора · A1, A2».
//
// Payload'ы читаются ТОЛЕРАНТНО: старые записи писались без части полей, новые
// поля добавляются по ходу ТЗ. Нет поля — сегмент просто не выводится, строка
// не ломается. Имена камня/клиента/узора, которых нет в payload, приходят из
// `HistoryLookups` — их страница собирает пакетными запросами (без N+1).

export type HistoryShipmentLineInfo = {
  id: string;
  stoneName: string | null;
  patternLabel: string | null;
  location: string | null;
  unitLabel: string | null;
};

export type HistoryShipmentInfo = {
  clientName: string | null;
  lines: HistoryShipmentLineInfo[];
};

export type HistorySampleInfo = {
  stoneName: string | null;
  clientName: string | null;
  unitLabel: string | null;
  patternLabel: string | null;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
};

/** Справочники для журнала. Все необязательны — нет карты, нет и сегмента. */
export type HistoryLookups = {
  batches?: Map<string, { stoneName: string | null }>;
  slabs?: Map<string, { stoneName: string | null; label: string }>;
  pieces?: Map<string, { stoneName: string | null }>;
  /** batchPatternId → описание узора («ТЕСТ светлый 2см»). */
  patterns?: Map<string, string>;
  clients?: Map<string, string>;
  /** saleRecordId → имя покупателя (возврат, продажа образца). */
  sales?: Map<string, { customerName: string }>;
  locations?: Map<
    string,
    { stoneName: string | null; block: string; landmark: string }
  >;
  shipments?: Map<string, HistoryShipmentInfo>;
  samples?: Map<string, HistorySampleInfo>;
};

export type HistoryRow = {
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
};

export type HistoryDescription = {
  /** Основная строка без названия действия (его несёт badge). */
  summary: string;
  /** Правки «Поле: было → стало» — по одной на строку. */
  changes: string[];
};

/** Id, которые нужно разрешить в имена (страница грузит их пакетно). */
export type HistoryRefs = {
  batchIds: Set<string>;
  slabIds: Set<string>;
  pieceIds: Set<string>;
  patternIds: Set<string>;
  clientIds: Set<string>;
  saleIds: Set<string>;
  locationIds: Set<string>;
  shipmentIds: Set<string>;
  sampleIds: Set<string>;
};

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Rec)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Число из number | Decimal-строки («24.690»); иначе null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstNum(rec: Rec, keys: string[]): number | null {
  for (const k of keys) {
    const n = num(rec[k]);
    if (n !== null) return n;
  }
  return null;
}

function firstStr(rec: Rec, keys: string[]): string | null {
  for (const k of keys) {
    const s = str(rec[k]);
    if (s) return s;
  }
  return null;
}

const NUM_RU = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/** «24,69» — запятая, до 2 знаков, обычные пробелы в разрядах. */
export function formatQtyNumber(n: number): string {
  return NUM_RU.format(n).replace(/[  ]/g, " ");
}

/** «6 пл. / 24,69 м²», «6 пл.», «24,69 м²» или null. Нули не показываем. */
export function formatHistoryQty(
  slabs: number | null,
  areaM2: number | null,
): string | null {
  const parts: string[] = [];
  if (slabs !== null && slabs !== 0) parts.push(`${formatQtyNumber(slabs)} пл.`);
  if (areaM2 !== null && areaM2 !== 0) parts.push(`${formatQtyNumber(areaM2)} м²`);
  return parts.length ? parts.join(" / ") : null;
}

/** 1 узор · 2 узора · 5 узоров. */
export function patternCountRu(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word =
    m10 === 1 && m100 !== 11
      ? "узор"
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
        ? "узора"
        : "узоров";
  return `${n} ${word}`;
}

/**
 * Снимок локации («Блок A1 · ориентир у ворот», см. formatLocation) → коротко
 * для журнала: «A1 (у ворот)». Другой формат — как есть.
 */
export function shortLocation(raw: string | null): string | null {
  const s = str(raw);
  if (!s) return null;
  const m = /^Блок\s+(.+?)(?:\s+·\s+ориентир\s+(.+))?$/.exec(s);
  if (!m) return s;
  return m[2] ? `${m[1]} (${m[2]})` : m[1];
}

function blockWithLandmark(block: unknown, landmark: unknown): string | null {
  const b = str(block);
  if (!b) return null;
  const lm = str(landmark);
  return lm && lm !== "—" ? `${b} (${lm})` : b;
}

function uniq(xs: (string | null)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}

/** Камень/ярлык единицы по entityType+entityId (и id из payload). */
function resolveUnit(
  row: HistoryRow,
  p: Rec,
  lk: HistoryLookups,
): { stoneName: string | null; unitLabel: string | null } {
  let stoneName = str(p.stoneName);
  let unitLabel = str(p.slabLabel);
  const slabId =
    row.entityType === "Slab" ? row.entityId : str(p.slabId);
  const pieceId =
    row.entityType === "Piece" ? row.entityId : str(p.pieceId);
  const batchId =
    row.entityType === "Batch" ? row.entityId : str(p.batchId);
  if (slabId) {
    const s = lk.slabs?.get(slabId);
    if (s) {
      stoneName ??= s.stoneName;
      unitLabel ??= s.label;
    }
  }
  if (pieceId) {
    const pc = lk.pieces?.get(pieceId);
    if (pc) stoneName ??= pc.stoneName;
    if (row.entityType === "Piece") unitLabel ??= "Бой/остаток";
  }
  if (batchId) stoneName ??= lk.batches?.get(batchId)?.stoneName ?? null;
  if (row.entityType === "BatchLocation") {
    stoneName ??= lk.locations?.get(row.entityId)?.stoneName ?? null;
  }
  return { stoneName, unitLabel };
}

function patternLabelOf(p: Rec, lk: HistoryLookups): string | null {
  const own = firstStr(p, ["patternLabel", "patternDescription"]);
  if (own) return own;
  const id = str(p.batchPatternId);
  return id ? (lk.patterns?.get(id) ?? null) : null;
}

function clientOf(p: Rec, lk: HistoryLookups): string | null {
  const name = firstStr(p, ["customerName", "clientName"]);
  if (name) return name;
  const id = str(p.clientId);
  if (id) {
    const c = lk.clients?.get(id);
    if (c) return c;
  }
  const saleId = firstStr(p, ["saleId", "saleRecordId"]);
  return saleId ? (lk.sales?.get(saleId)?.customerName ?? null) : null;
}

/** Сегменты через « · », клиент — хвостом « → Тимур». */
function join(segments: (string | null)[], client?: string | null): string {
  const body = segments.filter((s): s is string => !!s).join(" · ");
  if (!client) return body;
  return body ? `${body} → ${client}` : `→ ${client}`;
}

// ── правки «было → стало» ──

const FIELD_RU: Record<string, string> = {
  slabsTotal: "Плиты",
  areaTotalM2: "Площадь, м²",
  lengthMm: "Длина, см",
  widthMm: "Ширина, см",
  thicknessMm: "Толщина, см",
  supplierNote: "Поставщик / заметка",
  arrivedAt: "Дата прихода",
  locations: "Локации",
  description: "Описание",
  slabsCount: "плиты",
  areaM2: "площадь, м²",
  photo: "фото",
  block: "Блок",
  landmark: "Ориентир",
  note: "Заметка",
};

function changeValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "locations" && typeof v === "string") {
    // «A|1|6|24.6|pid;B||2||» (batch-edit.ts) → «A (1): 6 пл.; B: 2 пл.»
    return v
      .split(";")
      .filter(Boolean)
      .map((row) => {
        const [b, lm, sl, ar] = row.split("|");
        const where = blockWithLandmark(b, lm) ?? "?";
        const q = formatHistoryQty(num(sl), num(ar));
        return q ? `${where}: ${q}` : where;
      })
      .join("; ");
  }
  if (typeof v === "number") return formatQtyNumber(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  return String(v);
}

/** Одна правка: «Плиты: 6 → 5», «Узор «светлый»: плиты 3 → 2». */
export function formatFieldChange(
  change: { field: string; old: unknown; new: unknown },
  lk: HistoryLookups = {},
): string {
  const pm = /^pattern\.([^.]+)\.(.+)$/.exec(change.field);
  let label: string;
  let valueField = change.field;
  if (pm) {
    const desc = lk.patterns?.get(pm[1]);
    valueField = pm[2];
    label = `Узор${desc ? ` «${desc}»` : ""}: ${FIELD_RU[pm[2]] ?? pm[2]}`;
  } else {
    label = FIELD_RU[change.field] ?? change.field;
  }
  return `${label}: ${changeValue(valueField, change.old)} → ${changeValue(valueField, change.new)}`;
}

/** {from:{block,landmark}, to:{…}} (buildMovePayload) → правки. */
function fromToChanges(p: Rec): string[] {
  const from = asRec(p.from);
  const to = asRec(p.to);
  if (!from || !to) return [];
  const keys = uniq([...Object.keys(from), ...Object.keys(to)]).filter(
    (k) => k !== "locationId",
  );
  return keys.map((k) =>
    formatFieldChange({ field: k, old: from[k] ?? null, new: to[k] ?? null }),
  );
}

// ── по действиям ──

function describeIntake(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const { stoneName } = resolveUnit(row, p, lk);
  const patterns = Array.isArray(p.patterns) ? p.patterns.map(asRec) : [];
  const sumPat = (k: string) =>
    patterns.length
      ? patterns.reduce<number | null>((acc, pt) => {
          const n = pt ? num(pt[k]) : null;
          return n === null ? acc : (acc ?? 0) + n;
        }, null)
      : null;
  const slabs = firstNum(p, ["slabsTotal", "slabs", "qtySlabs"]) ?? sumPat("slabs");
  const area = firstNum(p, ["areaTotalM2", "areaM2", "qtyAreaM2"]) ?? sumPat("areaM2");
  const patternCount = firstNum(p, ["patternCount", "patternsCount"]) ??
    (patterns.length || null);
  const blocksRaw = Array.isArray(p.locationBlocks)
    ? p.locationBlocks
    : Array.isArray(p.blocks)
      ? p.blocks
      : null;
  const blocks = blocksRaw
    ? uniq(blocksRaw.map(str))
    : Array.isArray(p.locations)
      ? uniq(p.locations.map((l) => str(asRec(l)?.block)))
      : uniq([shortLocation(str(p.location))]);
  return {
    summary: join([
      stoneName,
      formatHistoryQty(slabs, area),
      patternCount ? patternCountRu(patternCount) : null,
      blocks.length ? blocks.join(", ") : null,
    ]),
    changes: [],
  };
}

function describeSale(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const { stoneName, unitLabel } = resolveUnit(row, p, lk);
  const client = clientOf(p, lk);
  const lines = Array.isArray(p.lines)
    ? p.lines.map(asRec).filter((l): l is Rec => l !== null)
    : [];
  if (lines.length > 0) {
    const parts = lines.map((l) =>
      join([
        patternLabelOf(l, lk),
        formatHistoryQty(
          firstNum(l, ["qtySlabs", "qtyOrderedSlabs"]),
          firstNum(l, ["qtyAreaM2", "qtyOrderedAreaM2"]),
        ),
        shortLocation(str(l.location) ?? str(l.locationSnapshot)),
      ]),
    );
    return {
      summary: join([stoneName, parts.filter(Boolean).join(" + ") || null], client),
      changes: [],
    };
  }
  return {
    summary: join(
      [
        stoneName,
        row.entityType === "Batch" ? patternLabelOf(p, lk) : unitLabel,
        formatHistoryQty(num(p.qtySlabs), num(p.qtyAreaM2)),
      ],
      client,
    ),
    changes: [],
  };
}

function describeShipment(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const ship = lk.shipments?.get(row.entityId);
  const lineId = str(p.lineId);
  const line =
    (lineId ? ship?.lines.find((l) => l.id === lineId) : undefined) ??
    (ship && ship.lines.length === 1 ? ship.lines[0] : undefined);
  const event = str(p.event);
  const stoneName =
    line?.stoneName ??
    resolveUnit(row, p, lk).stoneName ??
    (ship ? uniq(ship.lines.map((l) => l.stoneName)).join(", ") || null : null);
  if (event === "shipment_fact_photo") {
    return { summary: join([stoneName, line?.unitLabel ?? null, "фото факта"]), changes: [] };
  }
  if (event === "telegram_task_dispatch") {
    const ok = p.delivered === true;
    return {
      summary: join([stoneName, ok ? "задача отправлена в Telegram" : "Telegram: не доставлено"]),
      changes: [],
    };
  }
  return {
    summary: join(
      [
        stoneName,
        line?.patternLabel ?? null,
        line?.unitLabel ?? null,
        formatHistoryQty(num(p.addSlabs), num(p.addArea)),
        shortLocation(line?.location ?? null),
        p.fully === true ? "полностью" : null,
      ],
      ship?.clientName ?? null,
    ),
    changes: [],
  };
}

function describeSample(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const s = lk.samples?.get(row.entityId);
  const unit = resolveUnit(row, p, lk);
  return {
    summary: join(
      [
        s?.stoneName ?? unit.stoneName,
        s?.patternLabel ?? null,
        s?.unitLabel ?? unit.unitLabel,
        formatHistoryQty(s?.qtySlabs ?? null, s?.qtyAreaM2 ?? null),
      ],
      s?.clientName ?? clientOf(p, lk),
    ),
    changes: [],
  };
}

function describeMove(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const { stoneName, unitLabel } = resolveUnit(row, p, lk);
  const created = asRec(p.created);
  if (created) {
    return {
      summary: join([
        stoneName,
        `новая локация ${blockWithLandmark(created.block, created.landmark) ?? ""}`.trim(),
        formatHistoryQty(num(created.slabsHere), num(created.areaHereM2)),
      ]),
      changes: [],
    };
  }
  const from = asRec(p.from);
  const to = asRec(p.to);
  const qty = formatHistoryQty(num(p.qtySlabs), num(p.qtyAreaM2));
  if (from && to && qty) {
    // Перенос количества между локациями (moveBetweenLocations).
    return {
      summary: join([
        stoneName,
        qty,
        `${blockWithLandmark(from.block, from.landmark) ?? "?"} → ${blockWithLandmark(to.block, to.landmark) ?? "?"}`,
      ]),
      changes: [],
    };
  }
  const loc = row.entityType === "BatchLocation" ? lk.locations?.get(row.entityId) : undefined;
  return {
    summary: join([stoneName, unitLabel, loc ? blockWithLandmark(loc.block, loc.landmark) : null]),
    changes: fromToChanges(p),
  };
}

function describeAdjustment(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const kind = str(p.kind);
  if (kind === "KARTA_BLOCK_RENAME") {
    return {
      summary: `Блок ${str(p.from) ?? "?"} → ${str(p.to) ?? "?"}`,
      changes: [],
    };
  }
  const { stoneName, unitLabel } = resolveUnit(row, p, lk);
  const changes = Array.isArray(p.changes)
    ? p.changes
        .map(asRec)
        .filter((c): c is Rec => c !== null && typeof c.field === "string")
        .map((c) => formatFieldChange({ field: c.field as string, old: c.old, new: c.new }, lk))
    : [];
  // Старый/иной формат корректировки: delta по количеству.
  const delta = formatHistoryQty(
    firstNum(p, ["deltaSlabs", "slabsDelta"]),
    firstNum(p, ["deltaAreaM2", "areaDelta"]),
  );
  return {
    summary:
      join([stoneName, unitLabel, delta ? `изменение ${delta}` : null]) ||
      fallbackTarget(row, p),
    changes,
  };
}

function describeStatusChange(row: HistoryRow, p: Rec, lk: HistoryLookups): HistoryDescription {
  const { stoneName, unitLabel } = resolveUnit(row, p, lk);
  const nc = asRec(p.needsCheck);
  if (nc) {
    return {
      summary: join([
        stoneName,
        unitLabel,
        nc.to === true ? "помечено «проверить»" : "проверка снята",
      ]),
      changes: [],
    };
  }
  const kind = str(p.kind);
  if (kind === "stonetype.edit") {
    return { summary: join([str(p.name) ?? stoneName, "карточка вида изменена"]), changes: [] };
  }
  const changes =
    str(p.from) !== null || str(p.to) !== null
      ? [formatFieldChange({ field: "Статус", old: p.from, new: p.to })]
      : [];
  return {
    summary: join([stoneName, unitLabel]) || fallbackTarget(row, p),
    changes,
  };
}

/** Прежнее поведение — для действий без собственного формата. */
function fallbackTarget(row: HistoryRow, p: Rec): string {
  const stone = str(p.stoneName);
  if (stone) return stone;
  const slab = str(p.slabLabel);
  if (slab) return slab;
  const customer = str(p.customerName);
  if (customer) return `клиент ${customer}`;
  return `${entityLabelRu(row.entityType)} #${row.entityId.slice(0, 8)}`;
}

/**
 * Содержание записи журнала (ТЗ №19 E2). Pure: payload + справочники.
 * Не бросает на любом payload — худший случай прежний «Партия #a1b2c3d4».
 */
export function describeHistoryEntry(
  row: HistoryRow,
  lk: HistoryLookups = {},
): HistoryDescription {
  const p = asRec(row.payload) ?? {};
  let d: HistoryDescription;
  switch (row.action) {
    case "INTAKE":
      d = describeIntake(row, p, lk);
      break;
    case "SALE":
      d = describeSale(row, p, lk);
      break;
    case "SHIPMENT_CONFIRM":
      d = describeShipment(row, p, lk);
      break;
    case "SAMPLE_ISSUE":
    case "SAMPLE_RETURN":
    case "SAMPLE_SELL":
    case "SAMPLE_EXTEND":
      d = describeSample(row, p, lk);
      break;
    case "MOVE":
      d = describeMove(row, p, lk);
      break;
    case "ADJUSTMENT":
      d = describeAdjustment(row, p, lk);
      break;
    case "STATUS_CHANGE":
      d = describeStatusChange(row, p, lk);
      break;
    case "RESERVE":
    case "RESERVE_CANCEL":
    case "RESERVE_EXPIRE":
    case "RETURN": {
      const { stoneName, unitLabel } = resolveUnit(row, p, lk);
      const days = num(p.days);
      d = {
        summary: join(
          [
            stoneName,
            row.entityType === "Batch" ? patternLabelOf(p, lk) : unitLabel,
            formatHistoryQty(num(p.qtySlabs), num(p.qtyAreaM2)),
            row.action === "RESERVE" && days ? `на ${days} дн.` : null,
          ],
          clientOf(p, lk),
        ),
        changes: [],
      };
      break;
    }
    case "BREAK":
    case "SPLIT": {
      const { stoneName, unitLabel } = resolveUnit(row, p, lk);
      const pieces = num(p.pieceCount);
      const sold = asRec(p.soldPart);
      d = {
        summary: join(
          [
            stoneName,
            unitLabel,
            pieces ? `${pieces} кус.` : formatHistoryQty(null, num(p.areaM2)),
          ],
          sold ? str(sold.customerName) : null,
        ),
        changes: [],
      };
      break;
    }
    default: {
      const { stoneName, unitLabel } = resolveUnit(row, p, lk);
      d = { summary: join([stoneName, unitLabel]), changes: [] };
    }
  }
  if (!d.summary) d = { ...d, summary: fallbackTarget(row, p) };
  return d;
}

/** Полная строка «Продажа · Травертин Классик · … → Тимур» (тесты, текст). */
export function historyLineRu(row: HistoryRow, lk: HistoryLookups = {}): string {
  return `${actionLabelRu(row.action)} · ${describeHistoryEntry(row, lk).summary}`;
}

/** Собрать id из записей, которые стоит разрешить в имена (для пакетной загрузки). */
export function collectHistoryRefs(rows: readonly HistoryRow[]): HistoryRefs {
  const refs: HistoryRefs = {
    batchIds: new Set(),
    slabIds: new Set(),
    pieceIds: new Set(),
    patternIds: new Set(),
    clientIds: new Set(),
    saleIds: new Set(),
    locationIds: new Set(),
    shipmentIds: new Set(),
    sampleIds: new Set(),
  };
  const add = (set: Set<string>, v: unknown) => {
    const s = str(v);
    if (s) set.add(s);
  };
  for (const row of rows) {
    const p = asRec(row.payload) ?? {};
    switch (row.entityType) {
      case "Batch":
        refs.batchIds.add(row.entityId);
        break;
      case "Slab":
        refs.slabIds.add(row.entityId);
        break;
      case "Piece":
        refs.pieceIds.add(row.entityId);
        break;
      case "BatchLocation":
        refs.locationIds.add(row.entityId);
        break;
      case "Shipment":
        refs.shipmentIds.add(row.entityId);
        break;
      case "Sample":
        refs.sampleIds.add(row.entityId);
        break;
    }
    add(refs.batchIds, p.batchId);
    add(refs.slabIds, p.slabId);
    add(refs.pieceIds, p.pieceId);
    add(refs.patternIds, p.batchPatternId);
    add(refs.clientIds, p.clientId);
    if (!str(p.customerName)) {
      add(refs.saleIds, p.saleId);
      add(refs.saleIds, p.saleRecordId);
    }
    if (Array.isArray(p.lines)) {
      for (const l of p.lines) {
        const lr = asRec(l);
        if (lr && !str(lr.patternLabel)) add(refs.patternIds, lr.batchPatternId);
      }
    }
    if (Array.isArray(p.changes)) {
      for (const c of p.changes) {
        const f = str(asRec(c)?.field);
        const m = f ? /^pattern\.([^.]+)\./.exec(f) : null;
        if (m) refs.patternIds.add(m[1]);
      }
    }
  }
  return refs;
}
