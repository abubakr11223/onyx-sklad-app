"use server";

// Приёмка партии — server action (TZ §5.1, §6.3).
// Вся запись — ОДНОЙ транзакцией: StoneType (если новый) + Batch +
// BatchLocation[] + AuditLog(INTAKE) — правило data-model.md §1.10.

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { sendMessage } from "@/lib/telegram";
import {
  createAndDispatchPhotoRequest,
  PhotoRequestError,
} from "@/lib/photo-requests";
import {
  validateIntake,
  type IntakeErrors,
  type IntakeInput,
} from "@/lib/validators/intake";
import { strOf, allOf } from "@/lib/form";
import {
  createIntakeWithReceipt,
  IntakeConcurrentClaimError,
  IntakeFieldError,
  parseMutationId,
} from "@/lib/intake-receipt";

export interface IntakeFormState {
  errors: IntakeErrors;
}

/** ТЗ №7 §3 — предел размера фото узора (телефонный снимок ≈ до 15 МБ). */
const MAX_PATTERN_PHOTO_BYTES = 15 * 1024 * 1024;

// Простая транслитерация RU → latin для qrSlug (StoneType.qrSlug unique).
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
  ю: "yu", я: "ya",
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "vid";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

function readInput(formData: FormData): IntakeInput {
  const str = strOf(formData);
  const all = allOf(formData);
  const blocks = all("locBlock");
  const landmarks = all("locLandmark");
  const slabs = all("locSlabsHere");
  const areas = all("locAreaHereM2");
  // ТЗ №3 — узор-подгруппы (параллельные массивы).
  const patDesc = all("patDescription");
  const patThick = all("patThickness");
  const patLen = all("patLength");
  const patWid = all("patWidth");
  const patSlabs = all("patSlabs");
  const patArea = all("patArea");
  return {
    stoneTypeId: str("stoneTypeId"),
    newStoneType: formData.get("newStoneType") === "1",
    newName: str("newName"),
    newRockType: str("newRockType"),
    newColor: str("newColor"),
    newDescription: str("newDescription"),
    newBasePrice: str("newBasePrice"),
    slabsTotal: str("slabsTotal"),
    areaTotalM2: str("areaTotalM2"),
    lengthMm: str("lengthMm"),
    widthMm: str("widthMm"),
    thicknessMm: str("thicknessMm"),
    supplierNote: str("supplierNote"),
    arrivedAt: str("arrivedAt"),
    locations: blocks.map((block, i) => ({
      block,
      landmark: landmarks[i] ?? "",
      slabsHere: slabs[i] ?? "",
      areaHereM2: areas[i] ?? "",
    })),
    patternsEnabled: formData.get("patternsEnabled") === "1",
    patterns: patDesc.map((description, i) => ({
      description,
      thicknessMm: patThick[i] ?? "",
      lengthMm: patLen[i] ?? "",
      widthMm: patWid[i] ?? "",
      slabs: patSlabs[i] ?? "",
      areaM2: patArea[i] ?? "",
    })),
  };
}

export async function submitIntake(
  _prev: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  // R2 — DEFENSE-IN-DEPTH: приёмку делает склад (canManageWarehouse: OWNER/WAREHOUSE).
  // TZ §3: MANAGER складом не управляет. Прямой POST блокируется на сервере.
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return { errors: { form: "Нет доступа: приёмку оформляет склад" } };
  }

  const result = validateIntake(readInput(formData));
  if (!result.ok) return { errors: result.errors };
  const data = result.data;

  // W7-A2 — same logical intake must carry the same mutationId (client UUID).
  // Missing/invalid → refuse (do not silently mint server-side: that would
  // defeat de-dupe on retry).
  const mutationId = parseMutationId(formData.get("mutationId"));
  if (!mutationId) {
    return {
      errors: {
        form: "Сессия формы устарела — обновите страницу и повторите приёмку",
      },
    };
  }

  // userId в AuditLog nullable, поэтому пустая база не ломает приёмку.
  const actorId = await currentActorId();

  let summary: {
    stoneName: string;
    batchId: string;
    patternIds: string[];
    replay: boolean;
  };
  try {
    summary = await db.$transaction(async (tx) =>
      createIntakeWithReceipt(tx, {
        mutationId,
        actorId,
        data,
        canSeePrices: caps.canSeePrices,
        slugify,
        randomSuffix,
      }),
    );
  } catch (e) {
    // Concurrent race: this tx rolled back; winner's batch is committed.
    if (e instanceof IntakeConcurrentClaimError) {
      summary = e.winner;
    } else if (e instanceof IntakeFieldError) {
      return { errors: { [e.field]: e.message } };
    } else if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return {
        errors: {
          form: "Не удалось сохранить (конфликт уникальности) — попробуйте ещё раз",
        },
      };
    } else {
      throw e;
    }
  }

  // Replay / concurrent claim: domain already exists — skip Blob photos &
  // photo-requests (would duplicate side effects).

  // Side effects only on first successful create (not replay / concurrent claim).
  if (!summary.replay) {
    // ТЗ №7 §3 (BUG-02) — фото узор-подгрупп, загруженные ПРЯМО в форме приёмки.
    // Вне транзакции: партия уже сохранена, а put() в Blob — сетевая операция
    // (её сбой не должен откатывать приёмку). Индексы patPhoto выровнены с
    // data.patterns (валидация прошла → все строки на месте), а те — с patternIds.
    const patPhotoFiles = formData.getAll("patPhoto");
    const photographed = new Set<number>();
    if (summary.patternIds.length > 0) {
      // Аудит ТЗ №7 #29 — общий helper storePhotoBlob (put + Photo.create).
      const { storePhotoBlob } = await import("@/lib/photo-blob");
      const now = new Date();
      for (let i = 0; i < summary.patternIds.length; i++) {
        const file = patPhotoFiles[i];
        if (!(file instanceof File) || file.size === 0) continue; // фото не приложили
        if (!file.type.startsWith("image/") || file.size > MAX_PATTERN_PHOTO_BYTES) {
          continue; // не картинка / слишком большое — молча пропускаем (уйдёт в фотозапрос)
        }
        try {
          const buf = Buffer.from(await file.arrayBuffer());
          await storePhotoBlob({
            pathPrefix: `patterns/${summary.batchId}/${summary.patternIds[i]}-${now.getTime()}`,
            bytes: buf,
            mediaType: file.type,
            kind: "SAMPLE", // образец узора (не Telegram-file_id, а Blob-URL)
            takenAt: now, // «фиксация даты съёмки» — момент приёмки
            takenById: actorId,
            batchPatternId: summary.patternIds[i],
          });
          photographed.add(i);
        } catch (err) {
          // Фото не критично — партия сохранена; узор без фото уйдёт в фотозапрос ниже.
          console.error("[priemka] узор-фото загрузка упала:", err);
        }
      }
    }

    // ТЗ №3 — по узорам БЕЗ фото из формы АВТОМАТИЧЕСКИ ставим фотозапрос (Telegram).
    // ВНЕ транзакции: партия уже сохранена, сбой доставки НЕ откатывает приёмку.
    // Только когда есть actor (managerId — FK на User; в пустой базе actorId=null).
    if (summary.patternIds.length > 0 && actorId) {
      for (let i = 0; i < summary.patternIds.length; i++) {
        if (photographed.has(i)) continue; // фото уже приложено в форме — запрос не нужен
        try {
          await createAndDispatchPhotoRequest(
            {
              managerId: actorId,
              batchId: summary.batchId,
              batchPatternId: summary.patternIds[i],
              comment: `Узор: ${data.patterns[i].description}`,
            },
            { db, sendMessage },
          );
        } catch (err) {
          // Доставка не критична — партия сохранена. Логируем и продолжаем.
          if (!(err instanceof PhotoRequestError)) {
            console.error("[priemka] узор-фотозапрос ошибка:", err);
          }
        }
      }
    }
  }

  const params = new URLSearchParams({ ok: "1", stone: summary.stoneName });
  if (data.slabsTotal !== null) params.set("slabs", String(data.slabsTotal));
  if (data.areaTotalM2 !== null) params.set("area", String(data.areaTotalM2));
  redirect(`/priemka?${params.toString()}`);
}
