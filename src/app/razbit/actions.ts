"use server";

// «Разбить камень» — server actions (TZ §5.6, §6.4).
// Тонкий слой: чтение формы + чистая валидация (src/lib/breaking.ts) +
// вызов доменной логики. Вся запись — одной транзакцией внутри breaking.ts.

import { redirect } from "next/navigation";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import {
  BreakError,
  breakSlab,
  parsePieceRow,
  registerDirectPiece,
  splitSlab,
  type PieceInput,
  type RawPieceRow,
} from "@/lib/breaking";
import { parsePositiveDecimal } from "@/lib/validators/intake";

export type BreakFormErrors = Record<string, string>;

export interface BreakFormState {
  errors: BreakFormErrors;
}

// Действующий пользователь = текущий (getCurrentUser, DEMO-shim R1).
// TZ §4.3: «Бой/остаток ставит складчик». R1: identity plumbing only; role
// enforcement — R2+ (в дефолтном демо это менеджер — валидный User, FK-safe).
async function currentWarehouseUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

function readPieceRows(formData: FormData): RawPieceRow[] {
  const all = (name: string) => formData.getAll(name).map(String);
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

  const str = (name: string) => String(formData.get(name) ?? "").trim();
  const mode = str("mode");
  const errors: BreakFormErrors = {};
  const pieces = parseRows(readPieceRows(formData), errors);

  const byUserId = await currentWarehouseUserId();
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

      if (Object.keys(errors).length > 0) return { errors };

      if (hasSoldPart) {
        const result = await splitSlab({
          slabId,
          soldPart: { customerName: soldCustomerName, price: soldPrice },
          remainderPieces: pieces,
          byUserId,
        });
        redirect(successUrl("split", result.slabLabel, result.pieceIds.length, result.cancelledReservationId));
      } else {
        const result = await breakSlab({ slabId, pieces, byUserId });
        redirect(successUrl("break", result.slabLabel, result.pieceIds.length, result.cancelledReservationId));
      }
    }

    if (mode === "direct") {
      const batchId = str("batchId");
      if (!batchId) errors.batchId = "Выберите партию";
      if (Object.keys(errors).length > 0) return { errors };

      const decrementSlabs = formData.get("decrementSlabs") === "1";
      // Каждый кусок — своя транзакция (registerDirectPiece); при ошибке на
      // строке N куски 1…N−1 уже записаны — они реальные камни, это ок.
      let created = 0;
      for (const piece of pieces) {
        await registerDirectPiece({ ...piece, batchId, decrementSlabs, byUserId });
        created += 1;
      }
      redirect(successUrl("direct", null, created, null));
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
): string {
  const params = new URLSearchParams({ ok: "1", action, pieces: String(pieceCount) });
  if (label) params.set("label", label);
  if (cancelledReservationId) params.set("reserveCancelled", "1");
  return `/razbit?${params.toString()}`;
}
