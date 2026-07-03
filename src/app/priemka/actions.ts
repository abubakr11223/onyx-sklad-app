"use server";

// Приёмка партии — server action (TZ §5.1, §6.3).
// Вся запись — ОДНОЙ транзакцией: StoneType (если новый) + Batch +
// BatchLocation[] + AuditLog(INTAKE) — правило data-model.md §1.10.

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  validateIntake,
  type IntakeErrors,
  type IntakeInput,
} from "@/lib/validators/intake";

export interface IntakeFormState {
  errors: IntakeErrors;
}

/** Ошибка уровня БД, адресованная конкретному полю формы. */
class IntakeFieldError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}

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
  const str = (name: string) => String(formData.get(name) ?? "");
  const all = (name: string) => formData.getAll(name).map(String);
  const blocks = all("locBlock");
  const landmarks = all("locLandmark");
  const slabs = all("locSlabsHere");
  const areas = all("locAreaHereM2");
  return {
    stoneTypeId: str("stoneTypeId"),
    newStoneType: formData.get("newStoneType") === "1",
    newName: str("newName"),
    newRockType: str("newRockType"),
    newColor: str("newColor"),
    slabsTotal: str("slabsTotal"),
    areaTotalM2: str("areaTotalM2"),
    supplierNote: str("supplierNote"),
    arrivedAt: str("arrivedAt"),
    locations: blocks.map((block, i) => ({
      block,
      landmark: landmarks[i] ?? "",
      slabsHere: slabs[i] ?? "",
      areaHereM2: areas[i] ?? "",
    })),
  };
}

export async function submitIntake(
  _prev: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const result = validateIntake(readInput(formData));
  if (!result.ok) return { errors: result.errors };
  const data = result.data;

  let summary: { stoneName: string };
  try {
    summary = await db.$transaction(async (tx) => {
      // СТАБ авторизации (auth — следующий спринт): действующий складчик
      // берётся из seed по роли WAREHOUSE. userId в AuditLog nullable,
      // поэтому пустая база не ломает приёмку.
      const actor = await tx.user.findFirst({
        where: { role: "WAREHOUSE", isActive: true },
        select: { id: true },
      });

      let stoneTypeId: string;
      let stoneName: string;
      if (data.stoneType.kind === "existing") {
        const existing = await tx.stoneType.findUnique({
          where: { id: data.stoneType.id },
          select: { id: true, name: true, isArchived: true },
        });
        if (!existing || existing.isArchived) {
          throw new IntakeFieldError(
            "stoneTypeId",
            "Вид камня не найден — обновите страницу и выберите заново",
          );
        }
        stoneTypeId = existing.id;
        stoneName = existing.name;
      } else {
        const duplicate = await tx.stoneType.findUnique({
          where: { name: data.stoneType.name },
          select: { id: true },
        });
        if (duplicate) {
          throw new IntakeFieldError(
            "newName",
            "Вид с таким названием уже есть — выберите его из списка",
          );
        }
        // Случайный суффикс делает qrSlug практически уникальным;
        // остаточная коллизия уйдёт в общий catch P2002 ниже.
        const created = await tx.stoneType.create({
          data: {
            name: data.stoneType.name,
            rockType: data.stoneType.rockType,
            color: data.stoneType.color,
            qrSlug: `${slugify(data.stoneType.name)}-${randomSuffix()}`,
          },
          select: { id: true, name: true },
        });
        stoneTypeId = created.id;
        stoneName = created.name;
      }

      const batch = await tx.batch.create({
        data: {
          stoneTypeId,
          arrivedAt: data.arrivedAt,
          supplierNote: data.supplierNote,
          slabsTotal: data.slabsTotal,
          areaTotalM2: data.areaTotalM2 === null ? null : String(data.areaTotalM2),
          locations: {
            create: data.locations.map((loc) => ({
              block: loc.block,
              landmark: loc.landmark,
              slabsHere: loc.slabsHere,
              areaHereM2: loc.areaHereM2 === null ? null : String(loc.areaHereM2),
            })),
          },
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: actor?.id ?? null,
          action: "INTAKE",
          entityType: "Batch",
          entityId: batch.id,
          payload: {
            stoneTypeId,
            stoneName,
            newStoneType: data.stoneType.kind === "new",
            slabsTotal: data.slabsTotal,
            areaTotalM2: data.areaTotalM2,
            supplierNote: data.supplierNote,
            arrivedAt: data.arrivedAt.toISOString(),
            locations: data.locations.map((loc) => ({
              block: loc.block,
              landmark: loc.landmark,
              slabsHere: loc.slabsHere,
              areaHereM2: loc.areaHereM2,
            })),
          },
        },
      });

      return { stoneName };
    });
  } catch (e) {
    if (e instanceof IntakeFieldError) {
      return { errors: { [e.field]: e.message } };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        errors: { form: "Не удалось сохранить (конфликт уникальности) — попробуйте ещё раз" },
      };
    }
    throw e;
  }

  const params = new URLSearchParams({ ok: "1", stone: summary.stoneName });
  if (data.slabsTotal !== null) params.set("slabs", String(data.slabsTotal));
  if (data.areaTotalM2 !== null) params.set("area", String(data.areaTotalM2));
  redirect(`/priemka?${params.toString()}`);
}
