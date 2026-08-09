// Onyx — «Разбить камень» (S2-C): TZ §5.5, §5.6, §6.4.
// Нормативные источники: docs/data-model.md §2 (переходы 3, 6, 9;
// BROKEN_OFFCUT — терминал для Slab), §3 (инвариант «партия доим сходится»),
// §1.5 (Piece), §1.10 (AuditLog в ОДНОЙ транзакции с действием); ADR-004/005.
//
// Логика вызывается из server actions И из будущего Telegram-бота, поэтому:
//  - все проверки формы вынесены в чистые функции (без БД) — юнит-тесты
//    в src/tests/breaking.test.ts;
//  - ошибки типизированы (BreakError с кодом) — бот сможет показать своё
//    сообщение, не разбирая строку.

import type { PieceKind, UnitStatus, Prisma } from "@prisma/client";
import { db } from "./db";
import { computeFreeRemainder } from "./inventory";
import { lockBatchForUpdate } from "./batch-lock";
import { normalizeBlockLetter } from "./block-letter";
import { areaM2FromCm } from "./dimensions";
import {
  MAX_DECIMAL_FIELD,
  MAX_INT_FIELD,
  parsePositiveDecimal,
  parsePositiveInt,
} from "./validators/intake";

// ───────────────────────── Типизированные ошибки ─────────────────────────

export type BreakErrorCode =
  | "SLAB_NOT_FOUND"
  | "SLAB_SOLD" // §2: SOLD → BROKEN_OFFCUT запрещён
  | "SLAB_ALREADY_BROKEN" // §2: BROKEN_OFFCUT — терминал
  | "SLAB_IN_SAMPLE" // TZ №10: SAMPLE — камень у клиента
  | "SLAB_IN_SHOWROOM" // TZ №15: SHOWROOM — return first
  | "SLAB_STATUS_CHANGED" // гонка: условный UPDATE не нашёл ожидаемый статус
  | "BATCH_NOT_FOUND"
  | "NO_PIECES"
  | "INVALID_PIECE"
  | "INVALID_CAUSE" // TZ §5.6: причина боя/распила
  | "INSUFFICIENT_REMAINDER"; // §3: свободный остаток ушёл бы в минус

/** Ошибка домена «разбить камень» — код для бота/UI + русское сообщение. */
export class BreakError extends Error {
  constructor(
    public readonly code: BreakErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BreakError";
  }
}

// ───────────────────────── Чистые функции (без БД) ─────────────────────────

/** Минимум сторон у куска: треугольник (data-model.md §1.5 — форма неровная). */
export const MIN_SIDES = 3;

/**
 * «118, 64, 95, 610» → [118, 64, 95, 610].
 * Разделители: запятая, точка с запятой, пробелы. Каждая сторона — целое
 * положительное число (см). Меньше MIN_SIDES сторон или мусор → null.
 */
export function parseSidesMm(raw: string): number[] | null {
  const parts = raw.split(/[,;\s]+/).filter((p) => p !== "");
  if (parts.length < MIN_SIDES) return null;
  const sides: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    sides.push(n);
  }
  return sides;
}

/** Уже распарсенный массив сторон корректен? (защита на границе БД). */
export function validateSidesMm(sides: unknown): sides is number[] {
  return (
    Array.isArray(sides) &&
    sides.length >= MIN_SIDES &&
    sides.every((s) => Number.isSafeInteger(s) && s > 0)
  );
}

// ───────────── TZ §5.6 «Причины» — taxonomy (metadata, not inventory) ─────────────
// Spec examples (L185): «бой при перемещении, распил в цехе …, клиент порезал
// … и т.п.» → fixed short list + OTHER. §9: one select > free text analytics.

/** Max length for optional note when code = OTHER (phone-friendly). */
export const BREAK_CAUSE_NOTE_MAX = 80;

/**
 * Fixed causes from §5.6 examples + OTHER for «и т.п.».
 * Codes are stable for analytics; labelRu is what humans see.
 */
export const BREAK_CAUSES = [
  { code: "MOVE_BREAK", labelRu: "Бой при перемещении" },
  { code: "WORKSHOP_CUT", labelRu: "Распил в цехе (изделие)" },
  { code: "CLIENT_CUT", labelRu: "Клиент порезал купленный камень" },
  { code: "OTHER", labelRu: "Другое" },
] as const;

export type BreakCauseCode = (typeof BREAK_CAUSES)[number]["code"];

export type BreakCause = {
  code: BreakCauseCode;
  labelRu: string;
  /** Only meaningful for OTHER; otherwise null. */
  otherNote: string | null;
};

const BREAK_CAUSE_BY_CODE: Record<BreakCauseCode, string> = Object.fromEntries(
  BREAK_CAUSES.map((c) => [c.code, c.labelRu]),
) as Record<BreakCauseCode, string>;

export function isBreakCauseCode(v: string): v is BreakCauseCode {
  return Object.prototype.hasOwnProperty.call(BREAK_CAUSE_BY_CODE, v);
}

/**
 * Parse form/bot input. **Required** (empty → fail): analytics useless if blank,
 * but list is 4 taps max (§9 simplicity). OTHER may carry a short optional note.
 */
export function parseBreakCause(
  rawCode: string | null | undefined,
  otherNote?: string | null,
): { ok: true; cause: BreakCause } | { ok: false; message: string } {
  const code = (rawCode ?? "").trim();
  if (!code) {
    return { ok: false, message: "Укажите причину (бой / распил / …)" };
  }
  if (!isBreakCauseCode(code)) {
    return { ok: false, message: "Неизвестная причина — выберите из списка" };
  }
  const labelRu = BREAK_CAUSE_BY_CODE[code];
  let note: string | null = null;
  if (code === "OTHER") {
    const t = (otherNote ?? "").trim();
    if (t.length > BREAK_CAUSE_NOTE_MAX) {
      return {
        ok: false,
        message: `Пояснение — не длиннее ${BREAK_CAUSE_NOTE_MAX} символов`,
      };
    }
    note = t || null;
  }
  return { ok: true, cause: { code, labelRu, otherNote: note } };
}

/** AuditLog payload fields for BREAK/SPLIT (read-back + analytics). */
export function breakCauseAuditFields(cause: BreakCause): {
  breakReason: BreakCauseCode;
  breakReasonLabel: string;
  breakReasonNote: string | null;
} {
  return {
    breakReason: cause.code,
    breakReasonLabel: cause.labelRu,
    breakReasonNote: cause.otherNote,
  };
}


export type CanBreakResult =
  | { allowed: true; cancelsReservation: boolean }
  | {
      allowed: false;
      code:
        | "SLAB_SOLD"
        | "SLAB_ALREADY_BROKEN"
        | "SLAB_IN_SAMPLE"
        | "SLAB_IN_SHOWROOM";
      message: string;
    };

/**
 * Решение «можно ли разбить плиту» — data-model.md §2:
 * переходы 3 (AVAILABLE), 6 (RESERVED, бронь авто-CANCELLED) и
 * 9 (RETURNED — вернулся битым). SOLD, BROKEN_OFFCUT и SAMPLE (TZ №10) — явный запрет.
 */
export function canBreak(status: UnitStatus): CanBreakResult {
  switch (status) {
    case "AVAILABLE":
    case "RETURNED":
      return { allowed: true, cancelsReservation: false };
    case "RESERVED":
      return { allowed: true, cancelsReservation: true };
    case "SOLD":
      return {
        allowed: false,
        code: "SLAB_SOLD",
        message: "Плита уже продана — разбить нельзя",
      };
    case "BROKEN_OFFCUT":
      return {
        allowed: false,
        code: "SLAB_ALREADY_BROKEN",
        message: "Плита уже переведена в бой/остаток",
      };
    case "SAMPLE":
      return {
        allowed: false,
        code: "SLAB_IN_SAMPLE",
        message:
          "Плита выдана как образец — сначала оформите возврат образца",
      };
    case "SHOWROOM":
      return {
        allowed: false,
        code: "SLAB_IN_SHOWROOM",
        message:
          "Плита в шоу-руме — сначала верните на склад",
      };
  }
}

/**
 * Оценка площади куска по средней плите партии (data-model.md §3:
 * «o'lchov noaniqligi» — average = areaTotalM2 / slabsTotal).
 * Считается только когда партия отслеживает И площадь, И штуки.
 */
export function estimatePieceAreaM2(
  areaTotalM2: number | null,
  slabsTotal: number | null,
): number | null {
  if (areaTotalM2 === null || slabsTotal === null || slabsTotal <= 0) return null;
  return areaTotalM2 / slabsTotal;
}

/**
 * fixes0809 BUG-B: null area must not stay null when the batch tracks m².
 * Order: explicit input → bounding L×W (см → м²) → partiya o'rtachasi.
 * Pure — unit-tested; used by registerDirectPiece / registerDirectPiecesMany.
 */
export function resolveDirectPieceAreaM2(args: {
  areaM2: number | null;
  boundingLengthCm: number;
  boundingWidthCm: number;
  batchAreaTotalM2: number | null;
  batchSlabsTotal: number | null;
}): { areaM2: number | null; areaEstimated: boolean } {
  if (
    args.areaM2 !== null &&
    Number.isFinite(args.areaM2) &&
    args.areaM2 > 0
  ) {
    return { areaM2: args.areaM2, areaEstimated: false };
  }
  // Post TZ12: *Mm field values are centimetres; area from L×W in см.
  const fromBox = areaM2FromCm(
    args.boundingLengthCm,
    args.boundingWidthCm,
  );
  if (Number.isFinite(fromBox) && fromBox > 0) {
    return {
      areaM2: Math.round(fromBox * 1000) / 1000,
      areaEstimated: true,
    };
  }
  const avg = estimatePieceAreaM2(
    args.batchAreaTotalM2,
    args.batchSlabsTotal,
  );
  if (avg !== null) {
    return {
      areaM2: Math.round(avg * 1000) / 1000,
      areaEstimated: true,
    };
  }
  return { areaM2: null, areaEstimated: false };
}

/** Валидный кусок — вход для breakSlab / splitSlab / registerDirectPiece. */
export interface PieceInput {
  kind: PieceKind; // BROKEN (бой) | OFFCUT (остаток)
  sidesMm: number[];
  boundingLengthMm: number;
  boundingWidthMm: number;
  thicknessMm: number | null;
  areaM2: number | null;
  block: string;
  landmark: string;
}

/** Сырая строка формы (одна строка «кусок» на странице /razbit). */
export interface RawPieceRow {
  kind: string;
  sidesMm: string;
  boundingLengthMm: string;
  boundingWidthMm: string;
  thicknessMm: string;
  areaM2: string;
  block: string;
  landmark: string;
}

/** Ключ — поле строки («sidesMm», «block»…), значение — русское сообщение. */
export type PieceRowErrors = Record<string, string>;

export type ParsePieceRowResult =
  | { ok: true; data: PieceInput }
  | { ok: false; errors: PieceRowErrors };

/**
 * Парсер строки формы → PieceInput. Габариты bounding-прямоугольника
 * проверяются только на положительность: доказать «bounding ≤ комбинаций
 * сторон» в общем случае нельзя (форма произвольная), а мешать складчику —
 * против TZ §9 (простота важнее).
 */
export function parsePieceRow(row: RawPieceRow): ParsePieceRowResult {
  const errors: PieceRowErrors = {};

  const kind: PieceKind | null =
    row.kind === "BROKEN" || row.kind === "OFFCUT" ? row.kind : null;
  if (!kind) errors.kind = "Выберите: бой или остаток";

  // BUG-01 (ТЗ №4): «Стороны» — НЕОБЯЗАТЕЛЬНЫ (деталь формы для чертежа/AI).
  // Единственный обязательный источник размера — габариты (длина×ширина): по
  // ним ищут остатки. Пусто → прямоугольник [Д, Ш, Д, Ш]. Если введены —
  // минимум 3 стороны (иначе это не многоугольник).
  const sidesRaw = row.sidesMm.trim();
  let sidesMm: number[] | null = null;
  if (sidesRaw !== "") {
    sidesMm = parseSidesMm(row.sidesMm);
    if (!sidesMm) {
      errors.sidesMm =
        "Стороны — либо пусто, либо минимум 3 целых числа через запятую, например «118, 64, 95»";
    }
  }

  const boundingLengthMm = parsePositiveInt(row.boundingLengthMm);
  if (boundingLengthMm === null || boundingLengthMm === undefined) {
    errors.boundingLengthMm = "Длина, см — целое положительное число";
  }
  const boundingWidthMm = parsePositiveInt(row.boundingWidthMm);
  if (boundingWidthMm === null || boundingWidthMm === undefined) {
    errors.boundingWidthMm = "Ширина, см — целое положительное число";
  }

  const thicknessMm = parsePositiveInt(row.thicknessMm);
  if (thicknessMm === undefined) {
    errors.thicknessMm = "Толщина, см — целое положительное число";
  }
  const areaM2 = parsePositiveDecimal(row.areaM2);
  if (areaM2 === undefined) {
    errors.areaM2 = "Площадь — положительное число, например 1,2";
  }

  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр буквы блока (кир/лат дубли).
  const block = normalizeBlockLetter(row.block);
  const landmark = row.landmark.trim();
  if (!block) errors.block = "Укажите блок (например «А»)";
  if (!landmark) errors.landmark = "Укажите ориентир (например «2»)";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const len = boundingLengthMm as number;
  const wid = boundingWidthMm as number;
  return {
    ok: true,
    data: {
      kind: kind as PieceKind,
      // Пусто → прямоугольник из габаритов (валидный 4-угольник для чертежа).
      sidesMm: sidesMm ?? [len, wid, len, wid],
      boundingLengthMm: len,
      boundingWidthMm: wid,
      thicknessMm: (thicknessMm ?? null) as number | null,
      areaM2: (areaM2 ?? null) as number | null,
      block,
      landmark,
    },
  };
}

/** Защита на границе БД: PieceInput, собранный не через parsePieceRow (бот). */
export function assertValidPieceInput(p: PieceInput): void {
  if (!validateSidesMm(p.sidesMm)) {
    throw new BreakError(
      "INVALID_PIECE",
      "Стороны куска: минимум 3 целых положительных числа (см)",
    );
  }
  // A1: верхняя граница см (MAX_INT_FIELD) — иначе Int4-переполнение при вставке
  // Piece (bounding*/thickness — столбцы Int). Слишком большое → ошибка домена,
  // а не 500 из БД. Ловит и вход из бота (не через parsePieceRow).
  const posInt = (n: number) =>
    Number.isSafeInteger(n) && n > 0 && n <= MAX_INT_FIELD;
  if (!posInt(p.boundingLengthMm) || !posInt(p.boundingWidthMm)) {
    throw new BreakError("INVALID_PIECE", "Габариты куска — целые положительные см (не больше 1 000 000)");
  }
  if (p.thicknessMm !== null && !posInt(p.thicknessMm)) {
    throw new BreakError("INVALID_PIECE", "Толщина куска — целое положительное число (не больше 1 000 000)");
  }
  if (
    p.areaM2 !== null &&
    !(Number.isFinite(p.areaM2) && p.areaM2 > 0 && p.areaM2 <= MAX_DECIMAL_FIELD)
  ) {
    throw new BreakError("INVALID_PIECE", "Площадь куска — положительное число в допустимых пределах");
  }
  if (!p.block.trim() || !p.landmark.trim()) {
    throw new BreakError("INVALID_PIECE", "У куска должны быть блок и ориентир");
  }
}

// ───────────────────────── Внутреннее: общий переход ─────────────────────────

interface SlabForBreak {
  id: string;
  batchId: string;
  stoneTypeId: string;
  label: string;
  status: UnitStatus;
}

interface TransitionResult {
  slab: SlabForBreak;
  previousStatus: UnitStatus;
  cancelledReservationId: string | null;
}

/**
 * Общая часть breakSlab/splitSlab: условный перевод плиты в BROKEN_OFFCUT
 * (§2: UPDATE … WHERE status = <ожидаемый> — 0 строк ⇒ гонка, явная ошибка)
 * + авто-отмена активной брони (переход 6) с AuditLog(RESERVE_CANCEL),
 * чтобы менеджер увидел, ПОЧЕМУ бронь пропала.
 */
async function transitionSlabToBroken(
  tx: Prisma.TransactionClient,
  slabId: string,
  byUserId: string,
  reason: string,
): Promise<TransitionResult> {
  const slab = await tx.slab.findUnique({
    where: { id: slabId },
    select: { id: true, batchId: true, stoneTypeId: true, label: true, status: true },
  });
  if (!slab) throw new BreakError("SLAB_NOT_FOUND", "Плита не найдена");

  const decision = canBreak(slab.status);
  if (!decision.allowed) throw new BreakError(decision.code, decision.message);

  const updated = await tx.slab.updateMany({
    where: { id: slab.id, status: slab.status },
    data: { status: "BROKEN_OFFCUT" },
  });
  if (updated.count === 0) {
    throw new BreakError(
      "SLAB_STATUS_CHANGED",
      "Статус плиты только что изменился — обновите страницу и попробуйте снова",
    );
  }

  let cancelledReservationId: string | null = null;
  if (decision.cancelsReservation) {
    const reservation = await tx.reservation.findFirst({
      where: { slabId: slab.id, status: "ACTIVE" },
      select: { id: true, managerId: true, customerName: true },
    });
    if (reservation) {
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: byUserId,
          action: "RESERVE_CANCEL",
          entityType: "Reservation",
          entityId: reservation.id,
          payload: {
            reason, // «камень разбит» / «камень распилен»
            slabId: slab.id,
            slabLabel: slab.label,
            managerId: reservation.managerId,
            customerName: reservation.customerName,
          },
        },
      });
      cancelledReservationId = reservation.id;
    }
  }

  return { slab, previousStatus: slab.status, cancelledReservationId };
}

/** Куски из плиты: originSlabId ЗАПОЛНЕН ⇒ в формуле §3 НЕ участвуют. */
async function createSlabPieces(
  tx: Prisma.TransactionClient,
  slab: SlabForBreak,
  pieces: readonly PieceInput[],
  byUserId: string,
): Promise<string[]> {
  const pieceIds: string[] = [];
  for (const p of pieces) {
    const piece = await tx.piece.create({
      data: {
        stoneTypeId: slab.stoneTypeId,
        batchId: slab.batchId, // партия копируется с плиты
        originSlabId: slab.id,
        kind: p.kind,
        sidesMm: p.sidesMm,
        boundingLengthMm: p.boundingLengthMm,
        boundingWidthMm: p.boundingWidthMm,
        thicknessMm: p.thicknessMm,
        areaM2: p.areaM2 === null ? null : String(p.areaM2),
        // drawingUrl остаётся пустым — фото/AI-чертёж придут позже (TZ §5.5).
        block: p.block,
        landmark: p.landmark,
        createdById: byUserId,
      },
      select: { id: true },
    });
    pieceIds.push(piece.id);
  }
  return pieceIds;
}

function piecesPayload(pieces: readonly PieceInput[]) {
  return pieces.map((p) => ({
    kind: p.kind,
    sidesMm: p.sidesMm,
    boundingLengthMm: p.boundingLengthMm,
    boundingWidthMm: p.boundingWidthMm,
    thicknessMm: p.thicknessMm,
    areaM2: p.areaM2,
    block: p.block,
    landmark: p.landmark,
  }));
}

// ───────────────────────── breakSlab — TZ §6.4, случай А ─────────────────────────

export interface BreakSlabParams {
  slabId: string;
  pieces: PieceInput[];
  byUserId: string;
  /** TZ §5.6 — required cause (metadata only; not inventory). */
  cause: BreakCause;
}

export interface BreakSlabResult {
  slabId: string;
  slabLabel: string;
  previousStatus: UnitStatus;
  pieceIds: string[];
  cancelledReservationId: string | null;
}

/**
 * Бой: плита → BROKEN_OFFCUT + ≥1 Piece с originSlabId (одна транзакция,
 * §1.10). Куски НЕ списываются из партии повторно — плита уже минус в §3.
 */
export async function breakSlab(params: BreakSlabParams): Promise<BreakSlabResult> {
  if (params.pieces.length === 0) {
    throw new BreakError("NO_PIECES", "Укажите хотя бы один кусок (бой/остаток)");
  }
  params.pieces.forEach(assertValidPieceInput);
  if (!params.cause?.code || !isBreakCauseCode(params.cause.code)) {
    throw new BreakError("INVALID_CAUSE", "Укажите причину (бой / распил / …)");
  }

  return db.$transaction(async (tx) => {
    const { slab, previousStatus, cancelledReservationId } =
      await transitionSlabToBroken(
        tx,
        params.slabId,
        params.byUserId,
        `камень разбит (${params.cause.labelRu})`,
      );

    const pieceIds = await createSlabPieces(tx, slab, params.pieces, params.byUserId);

    await tx.auditLog.create({
      data: {
        userId: params.byUserId,
        action: "BREAK",
        entityType: "Slab",
        entityId: slab.id,
        payload: {
          slabLabel: slab.label,
          previousStatus,
          pieceCount: pieceIds.length,
          pieceIds,
          pieces: piecesPayload(params.pieces),
          cancelledReservationId,
          ...breakCauseAuditFields(params.cause),
        },
      },
    });

    return {
      slabId: slab.id,
      slabLabel: slab.label,
      previousStatus,
      pieceIds,
      cancelledReservationId,
    };
  });
}

// ───────────────────────── splitSlab — TZ §6.4, случай Б ─────────────────────────

export interface SplitSoldPart {
  customerName: string;
  price: number | null;
}

export interface SplitSlabParams {
  slabId: string;
  /** Часть ушла клиенту/в изделие (TZ §5.6/§8): фиксируется в payload SPLIT И
   *  создаёт SaleRecord (targetType=SLAB) той же транзакцией, чтобы проданная
   *  часть была видна в «Последних продажах». Остаток инвентаря НЕ трогается —
   *  плита уже списана распилом (SaleRecord history-only, см. ниже). */
  soldPart?: SplitSoldPart;
  remainderPieces: PieceInput[];
  byUserId: string;
  /** TZ §5.6 — required cause (metadata only). */
  cause: BreakCause;
}

export interface SplitSlabResult extends BreakSlabResult {
  soldPart: SplitSoldPart | null;
  /** id созданного SaleRecord для проданной части, иначе null. */
  soldSaleId: string | null;
}

/**
 * Распил (TZ §6.4 случай Б): плита → BROKEN_OFFCUT, остатки — Piece с
 * originSlabId. Проданная часть (soldPart) записывается в payload AuditLog(SPLIT)
 * И оформляется как SaleRecord(targetType=SLAB, slabId=плита) той же транзакцией
 * (TZ §5.6/§8), чтобы попасть в историю продаж «кому ушло».
 *
 * ВАЖНО (нет двойного списания): SaleRecord НЕ входит в формулу свободного
 * остатка §3 (inventory.computeFreeRemainder оперирует счётчиками партии,
 * плитами и прямыми кусками — SaleRecord там нет). Плита уже вычтена из остатка
 * самим распилом (переход в BROKEN_OFFCUT + originSlabId-куски вне формулы), а
 * SaleRecord здесь — только история/выручка, поэтому остаток он не двигает.
 */
export async function splitSlab(params: SplitSlabParams): Promise<SplitSlabResult> {
  if (params.remainderPieces.length === 0) {
    throw new BreakError(
      "NO_PIECES",
      "Укажите хотя бы один остаток. Если остатка нет — это продажа целиком, оформляется в продажах",
    );
  }
  params.remainderPieces.forEach(assertValidPieceInput);
  if (!params.cause?.code || !isBreakCauseCode(params.cause.code)) {
    throw new BreakError("INVALID_CAUSE", "Укажите причину (бой / распил / …)");
  }
  const soldPart = params.soldPart ?? null;

  return db.$transaction(async (tx) => {
    const { slab, previousStatus, cancelledReservationId } =
      await transitionSlabToBroken(
        tx,
        params.slabId,
        params.byUserId,
        `камень распилен (${params.cause.labelRu})`,
      );

    const pieceIds = await createSlabPieces(
      tx,
      slab,
      params.remainderPieces,
      params.byUserId,
    );

    // TZ §5.6/§8: проданная часть → SaleRecord (history-only, остаток не двигает —
    // см. док-комментарий функции). targetType=SLAB, slabId=распиленная плита
    // (соответствует CHECK-constraint SaleRecord: SLAB ⇒ только slabId).
    let soldSaleId: string | null = null;
    if (soldPart) {
      const customerName = soldPart.customerName.trim();
      const sale = await tx.saleRecord.create({
        data: {
          managerId: params.byUserId,
          customerName,
          customerContact: null,
          targetType: "SLAB",
          slabId: slab.id,
          price: soldPart.price === null ? null : soldPart.price.toFixed(2),
          soldAt: new Date(),
        },
        select: { id: true },
      });
      soldSaleId = sale.id;
    }

    await tx.auditLog.create({
      data: {
        userId: params.byUserId,
        action: "SPLIT",
        entityType: "Slab",
        entityId: slab.id,
        payload: {
          slabLabel: slab.label,
          previousStatus,
          // {customerName, price} | null — также оформлено в SaleRecord (§5.6/§8)
          soldPart: soldPart
            ? { customerName: soldPart.customerName, price: soldPart.price }
            : null,
          soldSaleId,
          pieceCount: pieceIds.length,
          pieceIds,
          pieces: piecesPayload(params.remainderPieces),
          cancelledReservationId,
          ...breakCauseAuditFields(params.cause),
        },
      },
    });

    return {
      slabId: slab.id,
      slabLabel: slab.label,
      previousStatus,
      pieceIds,
      cancelledReservationId,
      soldPart,
      soldSaleId,
    };
  });
}

// ──────────────────── registerDirectPiece — бой без плиты ────────────────────

export interface RegisterDirectPieceParams extends PieceInput {
  batchId: string;
  /**
   * @deprecated fixes0809 BUG-A: §3 always −1 slab per direct Piece
   * (originSlabId IS NULL). Flag is ignored for remainder arithmetic; kept for
   * audit payload / call-site compatibility. UI checkbox removed.
   */
  decrementSlabs?: boolean;
  byUserId: string;
  /** §5.5b: AI-chertyoj (o'zi-yetarli SVG data-URI). Ixtiyoriy — default null. */
  drawingUrl?: string | null;
  /** TZ §5.6 — required cause (metadata; same field as /razbit). */
  cause: BreakCause;
}

export interface RegisterDirectPieceResult {
  pieceId: string;
  areaM2: number | null;
  areaEstimated: boolean;
  slabsFreeAfter: number | null;
  areaFreeM2After: number | null;
}

function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

/**
 * Бой, найденный в партии без выделенной плиты: Piece с originSlabId = null —
 * §3: ALWAYS −1 к slabsFree и −areaM2 к areaFreeM2 (data-model.md §3).
 * Area never stays null when the batch tracks m² (fixes0809 BUG-B).
 */
export async function registerDirectPiece(
  params: RegisterDirectPieceParams,
): Promise<RegisterDirectPieceResult> {
  assertValidPieceInput(params);
  if (!params.cause?.code || !isBreakCauseCode(params.cause.code)) {
    throw new BreakError("INVALID_CAUSE", "Укажите причину (бой / распил / …)");
  }

  return db.$transaction(async (tx) => {
    // S2-conc: прямой Piece (originSlabId = null) — вход формулы §3 (−1 к
    // slabsFree, −areaM2 к areaFreeM2). Замок на строку партии ПЕРВЫМ, до чтения
    // счётчиков/плит/кусков, сериализует эту вставку с параллельной продажей
    // объёма / другим прямым боем — иначе guard читает устаревший остаток и
    // партию можно увести в минус (см. batch-lock.ts).
    await lockBatchForUpdate(tx, params.batchId);
    const batch = await tx.batch.findUnique({
      where: { id: params.batchId },
      select: {
        id: true,
        stoneTypeId: true,
        slabsTotal: true,
        areaTotalM2: true,
        slabsAdjusted: true,
        areaAdjustedM2: true,
        slabsSoldDirect: true,
        areaSoldDirectM2: true,
        slabs: { select: { areaM2: true } },
        pieces: { where: { originSlabId: null }, select: { areaM2: true } },
      },
    });
    if (!batch) throw new BreakError("BATCH_NOT_FOUND", "Партия не найдена");

    const resolved = resolveDirectPieceAreaM2({
      areaM2: params.areaM2,
      boundingLengthCm: params.boundingLengthMm,
      boundingWidthCm: params.boundingWidthMm,
      batchAreaTotalM2: toNum(batch.areaTotalM2),
      batchSlabsTotal: batch.slabsTotal,
    });
    const areaM2 = resolved.areaM2;
    const areaEstimated = resolved.areaEstimated;
    // If the batch tracks m², refuse a silent null (would inflate free m²).
    if (areaM2 === null && batch.areaTotalM2 !== null) {
      throw new BreakError(
        "INVALID_PIECE",
        "Укажите площадь куска (м²) или габариты длины и ширины",
      );
    }

    // Guard §3: пересчёт свободного остатка С УЧЁТОМ нового куска.
    // Always include piece in directPieces (BUG-A: no optional slab debit).
    const after = computeFreeRemainder(
      {
        slabsTotal: batch.slabsTotal,
        areaTotalM2: toNum(batch.areaTotalM2),
        slabsAdjusted: batch.slabsAdjusted,
        areaAdjustedM2: toNum(batch.areaAdjustedM2) ?? 0,
        slabsSoldDirect: batch.slabsSoldDirect,
        areaSoldDirectM2: toNum(batch.areaSoldDirectM2) ?? 0,
      },
      batch.slabs.map((s) => ({ areaM2: toNum(s.areaM2) })),
      [...batch.pieces.map((p) => ({ areaM2: toNum(p.areaM2) })), { areaM2 }],
    );
    if (after.slabsFree !== null && after.slabsFree < 0) {
      throw new BreakError(
        "INSUFFICIENT_REMAINDER",
        "В партии не осталось свободных плит — бой списать не из чего",
      );
    }
    if (after.areaFreeM2 !== null && after.areaFreeM2 < -1e-9) {
      throw new BreakError(
        "INSUFFICIENT_REMAINDER",
        "Площадь боя больше свободного остатка партии",
      );
    }

    const piece = await tx.piece.create({
      data: {
        stoneTypeId: batch.stoneTypeId,
        batchId: batch.id,
        originSlabId: null,
        kind: params.kind,
        sidesMm: params.sidesMm,
        boundingLengthMm: params.boundingLengthMm,
        boundingWidthMm: params.boundingWidthMm,
        thicknessMm: params.thicknessMm,
        areaM2: areaM2 === null ? null : String(areaM2),
        drawingUrl: params.drawingUrl ?? null, // §5.5b — AI-chertyoj (ixtiyoriy)
        block: params.block,
        landmark: params.landmark,
        createdById: params.byUserId,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: params.byUserId,
        action: "BREAK",
        entityType: "Piece",
        entityId: piece.id,
        payload: {
          batchId: batch.id,
          direct: true, // без выделенной плиты
          // §3 always −1; flag kept true for journal clarity (checkbox removed).
          decrementSlabs: true,
          kind: params.kind,
          sidesMm: params.sidesMm,
          boundingLengthMm: params.boundingLengthMm,
          boundingWidthMm: params.boundingWidthMm,
          areaM2,
          areaEstimated,
          slabsFreeAfter: after.slabsFree,
          areaFreeM2After: after.areaFreeM2,
          ...breakCauseAuditFields(params.cause),
        },
      },
    });

    return {
      pieceId: piece.id,
      areaM2,
      areaEstimated,
      slabsFreeAfter: after.slabsFree,
      areaFreeM2After: after.areaFreeM2,
    };
  });
}

// ──────────────── registerDirectPiecesMany — многострочный бой (A4) ────────────────

export interface RegisterDirectPiecesManyParams {
  /** ≥1 кусок; block/landmark у каждого свои (PieceInput). */
  rows: PieceInput[];
  batchId: string;
  /**
   * @deprecated fixes0809 BUG-A: ignored for remainder; §3 always −1 per row.
   * Kept optional for call-site compatibility.
   */
  decrementSlabs?: boolean;
  byUserId: string;
  /** §5.5b: AI-chertyoj — общий (обычно null для /razbit direct). */
  drawingUrl?: string | null;
  /** TZ §5.6 — required cause (one cause for the whole multi-row submit). */
  cause: BreakCause;
}

export interface RegisterDirectPiecesManyResult {
  pieceIds: string[];
  slabsFreeAfter: number | null;
  areaFreeM2After: number | null;
}

/**
 * A4: несколько прямых боёв (originSlabId = null) ОДНОЙ транзакцией —
 * атомарно, всё-или-ничего. В отличие от цикла registerDirectPiece (по
 * транзакции на строку), здесь:
 *  • ОДИН lockBatchForUpdate ПЕРВЫМ оператором (та же гарантия сериализации §3);
 *  • guard §3 считается на СУММЕ всех строк (не построчно) — партия не уйдёт
 *    в минус из-за агрегата, даже если каждая строка по отдельности прошла бы;
 *  • при ошибке (guard/валидация) не пишется НИ одной строки — worker не
 *    получит форму, наполовину сохранённую, и не задублирует при повторе.
 * Поведение registerDirectPiece НЕ меняется — у него свои вызывающие (в т.ч.
 * §5.5b singan), которым нужна одна строка на транзакцию.
 */
export async function registerDirectPiecesMany(
  params: RegisterDirectPiecesManyParams,
): Promise<RegisterDirectPiecesManyResult> {
  if (params.rows.length === 0) {
    throw new BreakError("NO_PIECES", "Укажите хотя бы один кусок (бой/остаток)");
  }
  params.rows.forEach(assertValidPieceInput);
  if (!params.cause?.code || !isBreakCauseCode(params.cause.code)) {
    throw new BreakError("INVALID_CAUSE", "Укажите причину (бой / распил / …)");
  }

  return db.$transaction(async (tx) => {
    // S2-conc: замок на строку партии ПЕРВЫМ — до чтения счётчиков/плит/кусков.
    await lockBatchForUpdate(tx, params.batchId);
    const batch = await tx.batch.findUnique({
      where: { id: params.batchId },
      select: {
        id: true,
        stoneTypeId: true,
        slabsTotal: true,
        areaTotalM2: true,
        slabsAdjusted: true,
        areaAdjustedM2: true,
        slabsSoldDirect: true,
        areaSoldDirectM2: true,
        slabs: { select: { areaM2: true } },
        pieces: { where: { originSlabId: null }, select: { areaM2: true } },
      },
    });
    if (!batch) throw new BreakError("BATCH_NOT_FOUND", "Партия не найдена");

    // Area resolution per row (BUG-B): never leave null when batch tracks m².
    const prepared = params.rows.map((p) => {
      const resolved = resolveDirectPieceAreaM2({
        areaM2: p.areaM2,
        boundingLengthCm: p.boundingLengthMm,
        boundingWidthCm: p.boundingWidthMm,
        batchAreaTotalM2: toNum(batch.areaTotalM2),
        batchSlabsTotal: batch.slabsTotal,
      });
      if (resolved.areaM2 === null && batch.areaTotalM2 !== null) {
        throw new BreakError(
          "INVALID_PIECE",
          "Укажите площадь куска (м²) или габариты длины и ширины",
        );
      }
      return {
        input: p,
        areaM2: resolved.areaM2,
        areaEstimated: resolved.areaEstimated,
      };
    });

    // Guard §3 на АГРЕГАТЕ: каждый прямой кусок −1 плита (§3 / BUG-A).
    const after = computeFreeRemainder(
      {
        slabsTotal: batch.slabsTotal,
        areaTotalM2: toNum(batch.areaTotalM2),
        slabsAdjusted: batch.slabsAdjusted,
        areaAdjustedM2: toNum(batch.areaAdjustedM2) ?? 0,
        slabsSoldDirect: batch.slabsSoldDirect,
        areaSoldDirectM2: toNum(batch.areaSoldDirectM2) ?? 0,
      },
      batch.slabs.map((s) => ({ areaM2: toNum(s.areaM2) })),
      [
        ...batch.pieces.map((p) => ({ areaM2: toNum(p.areaM2) })),
        ...prepared.map((pp) => ({ areaM2: pp.areaM2 })),
      ],
    );
    if (after.slabsFree !== null && after.slabsFree < 0) {
      throw new BreakError(
        "INSUFFICIENT_REMAINDER",
        "В партии не осталось столько свободных плит — бой списать не из чего",
      );
    }
    if (after.areaFreeM2 !== null && after.areaFreeM2 < -1e-9) {
      throw new BreakError(
        "INSUFFICIENT_REMAINDER",
        "Суммарная площадь боя больше свободного остатка партии",
      );
    }

    const pieceIds: string[] = [];
    for (const pp of prepared) {
      const p = pp.input;
      const piece = await tx.piece.create({
        data: {
          stoneTypeId: batch.stoneTypeId,
          batchId: batch.id,
          originSlabId: null,
          kind: p.kind,
          sidesMm: p.sidesMm,
          boundingLengthMm: p.boundingLengthMm,
          boundingWidthMm: p.boundingWidthMm,
          thicknessMm: p.thicknessMm,
          areaM2: pp.areaM2 === null ? null : String(pp.areaM2),
          drawingUrl: params.drawingUrl ?? null,
          block: p.block,
          landmark: p.landmark,
          createdById: params.byUserId,
        },
        select: { id: true },
      });
      pieceIds.push(piece.id);

      await tx.auditLog.create({
        data: {
          userId: params.byUserId,
          action: "BREAK",
          entityType: "Piece",
          entityId: piece.id,
          payload: {
            batchId: batch.id,
            direct: true,
            batchRows: params.rows.length, // A4: часть атомарной многострочной записи
            decrementSlabs: true, // §3 always
            kind: p.kind,
            sidesMm: p.sidesMm,
            boundingLengthMm: p.boundingLengthMm,
            boundingWidthMm: p.boundingWidthMm,
            areaM2: pp.areaM2,
            areaEstimated: pp.areaEstimated,
            slabsFreeAfter: after.slabsFree,
            areaFreeM2After: after.areaFreeM2,
            ...breakCauseAuditFields(params.cause),
          },
        },
      });
    }

    return {
      pieceIds,
      slabsFreeAfter: after.slabsFree,
      areaFreeM2After: after.areaFreeM2,
    };
  });
}
