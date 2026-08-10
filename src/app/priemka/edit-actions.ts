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
import { parseThicknessCm } from "@/lib/dimensions";
import { strOf, allOf } from "@/lib/form";
import { ensureFormError } from "@/lib/form-errors";
import { putPhotoBlob } from "@/lib/photo-blob";

export type BatchEditFormState = {
  errors: Record<string, string>;
};

/** Same limit as intake pattern photo (priemka/actions). */
const MAX_PATTERN_PHOTO_BYTES = 15 * 1024 * 1024;

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
  // ТЗ №12 + решение владельца 2026-08-10: толщина ДРОБНАЯ (18 мм = 1,8 см).
  const thicknessMm = parseThicknessCm(str("thicknessMm"));
  if (thicknessMm === undefined) {
    errors.thicknessMm = "Толщина, см — число > 0 (например 2 или 1,8) или пусто";
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

  // Patterns (text) + optional photo ops (aligned by index with patId).
  const pIds = all("patId");
  const pDesc = all("patDesc");
  const pTh = all("patThickness");
  const pLen = all("patLength");
  const pWid = all("patWidth");
  const pSlabs = all("patSlabs");
  const pArea = all("patArea");
  const patPhotoFiles = formData.getAll("patPhoto");
  const patterns: BatchEditInput["patterns"] = [];
  type PhotoOp = NonNullable<BatchEditInput["patternPhotoOps"]>[number];
  const photoOps: PhotoOp[] = [];

  for (let i = 0; i < pIds.length; i++) {
    const id = (pIds[i] ?? "").trim();
    if (!id) continue;
    const description = (pDesc[i] ?? "").trim();
    if (!description) {
      errors[`pat-${i}-desc`] = "Описание узора обязательно";
    }
    // Толщина узор-подгруппы — тоже дробная (ТЗ №12).
    const th = parseThicknessCm(pTh[i] ?? "");
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

    // Photo: clear checkbox wins over new file if both set (explicit remove).
    const clear = formData.get(`patPhotoClear-${id}`) === "1";
    const file = patPhotoFiles[i];
    const hasFile =
      file instanceof File && file.size > 0 && file.type.startsWith("image/");
    if (clear) {
      photoOps.push({ patternId: id, op: "clear" });
    } else if (hasFile && file instanceof File) {
      if (file.size > MAX_PATTERN_PHOTO_BYTES) {
        errors[`pat-${i}-photo`] =
          "Фото узора слишком большое (макс. 15 МБ)";
      } else if (!file.type.startsWith("image/")) {
        errors[`pat-${i}-photo`] = "Фото узора — только изображение";
      } else {
        // Blob put BEFORE domain TX (network). DB Photo.create is inside applyBatchEdit.
        try {
          const buf = Buffer.from(await file.arrayBuffer());
          const { storageKey } = await putPhotoBlob({
            pathPrefix: `patterns/${batchId}/${id}-${Date.now()}`,
            bytes: buf,
            mediaType: file.type || "image/jpeg",
          });
          photoOps.push({
            patternId: id,
            op: "set",
            storageKey,
            takenAt: new Date(),
          });
        } catch {
          errors[`pat-${i}-photo`] =
            "Не удалось загрузить фото узора — повторите";
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors: ensureFormError(errors) };
  }
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
        thicknessMm: parseThicknessCm(str("expectedThicknessMm")) ?? null,
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
      patternPhotoOps: photoOps.length > 0 ? photoOps : undefined,
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
