"use server";

// TG-B1 — fotozapros: server action (TZ §5.3). Logika — src/lib/photo-requests.ts
// (kelajakdagi bot ham qayta ishlatadi); bu yerda faqat forma razbor,
// stub-avtorizatsiya va xatoni UI ga yo'naltirish.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import { sendMessage } from "@/lib/telegram";
import {
  PhotoRequestError,
  createAndDispatchPhotoRequest,
} from "@/lib/photo-requests";

/**
 * Действующий менеджер = текущий пользователь (getCurrentUser, DEMO-shim R1).
 * По умолчанию демо-роль MANAGER → как и раньше, разрешается в менеджера.
 * R1: identity plumbing only; role enforcement — R2+.
 */
async function currentManagerId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

/**
 * Куда вернуться после запроса фото. По умолчанию /poisk (поведение как было).
 * Защита от open-redirect: путь должен быть локальным (начинаться с «/», но не
 * «//» и не «/\» — иначе браузер трактует как внешний хост).
 */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) {
    return "/poisk";
  }
  return s;
}

export async function requestPhoto(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "").trim();
  const batchLocationId = String(formData.get("batchLocationId") ?? "").trim() || null;
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const next = safeNext(formData.get("next"));

  // R2 — DEFENSE-IN-DEPTH: запрос фото — canRequestPhoto (OWNER/MANAGER). Склад
  // видит наличие, но не шлёт фотозапросы. Прямой POST блокируется на сервере.
  if (!(await getCapabilities()).canRequestPhoto) {
    redirect(`${next}?photoErr=${encodeURIComponent("Нет доступа: запрос фото доступен менеджеру")}`);
  }

  if (!batchId) {
    redirect(`${next}?photoErr=${encodeURIComponent("Не указана партия")}`);
  }

  const managerId = await currentManagerId();
  if (!managerId) {
    redirect(
      `${next}?photoErr=${encodeURIComponent("Менеджер не найден — выполните заполнение базы (seed)")}`,
    );
  }

  try {
    await createAndDispatchPhotoRequest(
      { managerId, batchId, batchLocationId, comment },
      { db, sendMessage },
    );
  } catch (e) {
    if (e instanceof PhotoRequestError) {
      redirect(`${next}?photoErr=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }

  redirect(`${next}?photo=ok`);
}
