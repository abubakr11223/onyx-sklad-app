"use server";

// ТЗ №14 §3 — server actions: сохранить правку партии.

import { redirect } from "next/navigation";
import {
  applyBatchEdit,
  BatchEditError,
  parseDateOnly,
  parseLocationRow,
  parseOptionalCm,
  type BatchEditInput,
} from "@/lib/batch-edit";
import {
  parseQuantityField,
  parsePositiveInt,
  parsePositiveDecimal,
} from "@/lib/validators/intake";
import { getCapabilities, currentActorId } from "@/lib/session";
import { strOf, allOf } from "@/lib/form";

export type BatchEditFormState = {
  errors: Record<string, string>;
};

export async function submitBatchEdit(
  _prev: BatchEditFormState,
  formData: FormData,
): Promise<BatchEditFormState> {
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return { errors: { form: "Нет доступа: править партию может склад или владелец" } };
  }

  const actorId = await currentActorId();
  if (!actorId) {
    return { errors: { form: "Пользователь не найден — войдите снова" } };
  }

  // Access placeholder (ТЗ №14 §3.2): quantity → OWNER only; dims/details → warehouse.
  // canSeeHistory is OWNER-only in permissions.ts — use as owner proxy without new cap.
  const canEditQuantity = caps.canSeeHistory === true;

  const str = strOf(formData);
  const all = allOf(formData);
  const batchId = str("batchId");
  if (!batchId) return { errors: { form: "Партия не указана" } };

  const errors: Record<string, string> = {};

  const expSlabs = parseQuantityField(str("expectedSlabsTotal"), "int");
  const expArea = parseQuantityField(str("expectedAreaTotalM2"), "decimal");
  // expected sold: integers/decimals as stored (0 ok)
  const expSoldSlabsRaw = str("expectedSlabsSoldDirect");
  const expSoldSlabs = /^\d+$/.test(expSoldSlabsRaw)
    ? Number(expSoldSlabsRaw)
    : NaN;
  const expSoldArea = parsePositiveDecimal(str("expectedAreaSoldDirectM2"));
  const expSoldAreaVal =
    str("expectedAreaSoldDirectM2").trim() === "" ||
    str("expectedAreaSoldDirectM2").trim() === "0" ||
    str("expectedAreaSoldDirectM2").trim() === "0,0"
      ? 0
      : expSoldArea === null || expSoldArea === undefined
        ? NaN
        : expSoldArea;

  if (!Number.isSafeInteger(expSoldSlabs) || Number.isNaN(expSoldAreaVal)) {
    return {
      errors: {
        form: "Устаревшая форма — откройте партию заново",
      },
    };
  }

  const slabsTotal = parseQuantityField(str("slabsTotal"), "int");
  if (slabsTotal === undefined) {
    errors.slabsTotal = "Плиты — целое число или пусто";
  }
  const areaTotalM2 = parseQuantityField(str("areaTotalM2"), "decimal");
  if (areaTotalM2 === undefined) {
    errors.areaTotalM2 = "Площадь — число или пусто";
  }

  const lengthMm = parseOptionalCm(str("lengthMm"));
  if (lengthMm === undefined) errors.lengthMm = "Длина, см — целое > 0 или пусто";
  const widthMm = parseOptionalCm(str("widthMm"));
  if (widthMm === undefined) errors.widthMm = "Ширина, см — целое > 0 или пусто";
  const thicknessMm = parseOptionalCm(str("thicknessMm"));
  if (thicknessMm === undefined) {
    errors.thicknessMm = "Толщина, см — целое > 0 или пусто";
  }

  const arrivedAt = parseDateOnly(str("arrivedAt"));
  if (!arrivedAt) errors.arrivedAt = "Дата прихода — ГГГГ-ММ-ДД";

  const supplierNote = str("supplierNote").trim() || null;

  // Locations
  const locBlocks = all("locBlock");
  const locLms = all("locLandmark");
  const locSlabs = all("locSlabs");
  const locAreas = all("locArea");
  const locations: BatchEditInput["locations"] = [];
  for (let i = 0; i < Math.max(locBlocks.length, 1); i++) {
    const block = locBlocks[i] ?? "";
    const landmark = locLms[i] ?? "";
    if (!block.trim() && !landmark.trim()) continue;
    const parsed = parseLocationRow({
      block,
      landmark,
      slabsHere: locSlabs[i] ?? "",
      areaHereM2: locAreas[i] ?? "",
    });
    if (!parsed.ok) {
      errors[`loc-${i}`] = parsed.message;
      continue;
    }
    locations.push(parsed.data);
  }

  // Patterns
  const pIds = all("patId");
  const pDesc = all("patDesc");
  const pTh = all("patThickness");
  const pLen = all("patLength");
  const pWid = all("patWidth");
  const pSlabs = all("patSlabs");
  const pArea = all("patArea");
  const patterns: BatchEditInput["patterns"] = [];
  for (let i = 0; i < pIds.length; i++) {
    const id = (pIds[i] ?? "").trim();
    if (!id) continue;
    const description = (pDesc[i] ?? "").trim();
    if (!description) {
      errors[`pat-${i}-desc`] = "Описание узора обязательно";
    }
    const th = parseOptionalCm(pTh[i] ?? "");
    if (th === undefined) errors[`pat-${i}-th`] = "Толщина узора — см или пусто";
    const len = parseOptionalCm(pLen[i] ?? "");
    if (len === undefined) errors[`pat-${i}-len`] = "Длина узора — см или пусто";
    const wid = parseOptionalCm(pWid[i] ?? "");
    if (wid === undefined) errors[`pat-${i}-wid`] = "Ширина узора — см или пусто";
    const sc = parsePositiveInt(pSlabs[i] ?? "");
    if (sc === null || sc === undefined) {
      errors[`pat-${i}-slabs`] = "Плиты узора — целое > 0";
    }
    const ar = parsePositiveDecimal(pArea[i] ?? "");
    if (ar === null || ar === undefined) {
      errors[`pat-${i}-area`] = "Площадь узора — число > 0";
    }
    if (
      description &&
      th !== undefined &&
      len !== undefined &&
      wid !== undefined &&
      sc !== null &&
      sc !== undefined &&
      ar !== null &&
      ar !== undefined
    ) {
      patterns.push({
        id,
        description,
        thicknessMm: th,
        lengthMm: len,
        widthMm: wid,
        slabsCount: sc,
        areaM2: ar,
      });
    }
  }

  if (Object.keys(errors).length > 0) return { errors };
  if (slabsTotal === undefined || areaTotalM2 === undefined) {
    return { errors: { form: "Проверьте количество" } };
  }
  if (
    lengthMm === undefined ||
    widthMm === undefined ||
    thicknessMm === undefined ||
    !arrivedAt
  ) {
    return { errors: { form: "Проверьте размеры и дату" } };
  }

  try {
    const result = await applyBatchEdit({
      batchId,
      expected: {
        slabsTotal: expSlabs ?? null,
        areaTotalM2: expArea ?? null,
        slabsSoldDirect: expSoldSlabs,
        areaSoldDirectM2: expSoldAreaVal,
        lengthMm: parseOptionalCm(str("expectedLengthMm")) ?? null,
        widthMm: parseOptionalCm(str("expectedWidthMm")) ?? null,
        thicknessMm: parseOptionalCm(str("expectedThicknessMm")) ?? null,
        supplierNote: str("expectedSupplierNote").trim() || null,
        arrivedAtIso: str("expectedArrivedAt"),
      },
      slabsTotal: slabsTotal ?? null,
      areaTotalM2: areaTotalM2 ?? null,
      lengthMm,
      widthMm,
      thicknessMm,
      supplierNote,
      arrivedAt,
      locations,
      patterns,
      actorId,
      canEditQuantity,
    });
    redirect(
      `/priemka?edited=1&batch=${encodeURIComponent(result.batchId)}&n=${result.changes.length}`,
    );
  } catch (e) {
    if (e instanceof BatchEditError) {
      if (e.field) {
        return { errors: { [e.field]: e.message, form: e.message } };
      }
      return { errors: { form: e.message } };
    }
    throw e;
  }
}
