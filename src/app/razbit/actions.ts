"use server";

// «Разбить камень» — server actions (TZ §5.6, §6.4).
// Тонкий слой: чтение формы + чистая валидация (src/lib/breaking.ts) +
// вызов доменной логики. Вся запись — одной транзакцией внутри breaking.ts.

import { redirect } from "next/navigation";
import { getCapabilities, currentActorId } from "@/lib/session";
import {
  BreakError,
  breakSlab,
  parseBreakCause,
  parsePieceRow,
  registerDirectPiecesMany,
  splitSlab,
  type PieceInput,
  type RawPieceRow,
} from "@/lib/breaking";
import { parsePositiveDecimal } from "@/lib/validators/intake";
import { strOf, allOf } from "@/lib/form";
import { findUnknownLocations } from "@/lib/warehouse-grid";
import { ensureFormError } from "@/lib/form-errors";

export type BreakFormErrors = Record<string, string>;

export interface BreakFormState {
  errors: BreakFormErrors;
}

function readPieceRows(formData: FormData): RawPieceRow[] {
  const all = allOf(formData);
  const kinds = all("pKind");
  const sides = all("pSides");
  const lens = all("pBoundLen");
  const widths = all("pBoundWidth");
  const thicknesses = all("pThickness");
  const areas = all("pArea");
  const blocks = all("pBlock");
  const landmarks = all("pLandmark");
  return kinds.map((kind, i) => ({
    kind,
    sidesMm: sides[i] ?? "",
    boundingLengthMm: lens[i] ?? "",
    boundingWidthMm: widths[i] ?? "",
    thicknessMm: thicknesses[i] ?? "",
    areaM2: areas[i] ?? "",
    block: blocks[i] ?? "",
    landmark: landmarks[i] ?? "",
  }));
}

function parseRows(
  rows: RawPieceRow[],
  errors: BreakFormErrors,
): PieceInput[] {
  const pieces: PieceInput[] = [];
  if (rows.length === 0) {
    errors.pieces = "Добавьте хотя бы один кусок (бой/остаток)";
    return pieces;
  }
  rows.forEach((row, i) => {
    const parsed = parsePieceRow(row);
    if (parsed.ok) {
      pieces.push(parsed.data);
    } else {
      for (const [field, msg] of Object.entries(parsed.errors)) {
        errors[`p-${i}-${field}`] = msg;
      }
    }
  });
  return pieces;
}

export async function submitBreak(
  _prev: BreakFormState,
  formData: FormData,
): Promise<BreakFormState> {
  // R2 — DEFENSE-IN-DEPTH: бой/распил делает склад (canManageWarehouse:
  // OWNER/WAREHOUSE). TZ §3: MANAGER складом не управляет. Прямой POST блокируется.
  if (!(await getCapabilities()).canManageWarehouse) {
    return { errors: { form: "Нет доступа: разбить камень может склад" } };
  }

  const str = strOf(formData);
  const mode = str("mode");
  const errors: BreakFormErrors = {};
  const pieces = parseRows(readPieceRows(formData), errors);

  // ТЗ №17 §6 — локация куска только из карты склада (свободный ввод убран).
  for (const u of await findUnknownLocations(pieces)) {
    errors[`p-${u.index}-${u.reason}`] =
      u.reason === "block"
        ? `Блока «${u.block}» нет в карте склада. Выберите из списка.`
        : `В блоке «${u.block}» нет ориентира «${u.landmark}». Выберите из списка.`;
  }

  // TZ §5.6 — cause required (same taxonomy as /singan).
  const causeParsed = parseBreakCause(str("breakCause"), str("breakCauseNote"));
  if (!causeParsed.ok) {
    errors.breakCause = causeParsed.message;
  }

  const byUserId = await currentActorId();
  if (!byUserId) {
    return { errors: { form: "Складчик не найден в системе — обратитесь к администратору" } };
  }

  try {
    if (mode === "slab") {
      const slabId = str("slabId");
      if (!slabId) errors.slabId = "Выберите плиту";

      // «Часть ушла клиенту / в изделие» ⇒ это распил (TZ §6.4 случай Б).
      const hasSoldPart = formData.get("soldPart") === "1";
      let soldCustomerName = "";
      let soldPrice: number | null = null;
      if (hasSoldPart) {
        soldCustomerName = str("soldCustomerName");
        if (!soldCustomerName) {
          errors.soldCustomerName = "Укажите, кому ушла часть (клиент/заказ)";
        }
        const parsedPrice = parsePositiveDecimal(str("soldPrice"));
        if (parsedPrice === undefined) {
          errors.soldPrice = "Цена — положительное число, например 250";
        } else {
          soldPrice = parsedPrice;
        }
      }

      if (Object.keys(errors).length > 0 || !causeParsed.ok) {
        return { errors: ensureFormError(errors) };
      }

      if (hasSoldPart) {
        const result = await splitSlab({
          slabId,
          soldPart: { customerName: soldCustomerName, price: soldPrice },
          remainderPieces: pieces,
          byUserId,
          cause: causeParsed.cause,
        });
        redirect(
          successUrl(
            "split",
            result.slabLabel,
            result.pieceIds.length,
            result.cancelledReservationId,
            causeParsed.cause.labelRu,
          ),
        );
      } else {
        const result = await breakSlab({
          slabId,
          pieces,
          byUserId,
          cause: causeParsed.cause,
        });
        redirect(
          successUrl(
            "break",
            result.slabLabel,
            result.pieceIds.length,
            result.cancelledReservationId,
            causeParsed.cause.labelRu,
          ),
        );
      }
    }

    if (mode === "direct") {
      const batchId = str("batchId");
      if (!batchId) errors.batchId = "Выберите партию";
      if (Object.keys(errors).length > 0 || !causeParsed.ok) {
        return { errors: ensureFormError(errors) };
      }

      // A4: все строки — ОДНОЙ атомарной транзакцией (registerDirectPiecesMany).
      // §3 / fixes0809 BUG-A: every direct piece always −1 free slab (no checkbox).
      const result = await registerDirectPiecesMany({
        rows: pieces,
        batchId,
        byUserId,
        cause: causeParsed.cause,
      });
      redirect(
        successUrl(
          "direct",
          null,
          result.pieceIds.length,
          null,
          causeParsed.cause.labelRu,
        ),
      );
    }

    return { errors: { form: "Неизвестный режим формы — обновите страницу" } };
  } catch (e) {
    if (e instanceof BreakError) {
      return { errors: { form: e.message } };
    }
    throw e;
  }
}

function successUrl(
  action: string,
  label: string | null,
  pieceCount: number,
  cancelledReservationId: string | null,
  causeLabel: string,
): string {
  const params = new URLSearchParams({
    ok: "1",
    action,
    pieces: String(pieceCount),
    cause: causeLabel,
  });
  if (label) params.set("label", label);
  if (cancelledReservationId) params.set("reserveCancelled", "1");
  return `/razbit?${params.toString()}`;
}
