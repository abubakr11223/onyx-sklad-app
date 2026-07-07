"use server";

// TG-B1 — fotozapros: server action (TZ §5.3). Logika — src/lib/photo-requests.ts
// (kelajakdagi bot ham qayta ishlatadi); bu yerda faqat forma razbor,
// stub-avtorizatsiya va xatoni UI ga yo'naltirish.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import {
  PhotoRequestError,
  createAndDispatchPhotoRequest,
} from "@/lib/photo-requests";

/**
 * СТАБ авторизации (auth — следующий спринт): действующий менеджер берётся
 * из seed по роли MANAGER (тот же стаб, что в src/app/bron/actions.ts).
 */
async function currentManagerId(): Promise<string | null> {
  const manager = await db.user.findFirst({
    where: { role: "MANAGER", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return manager?.id ?? null;
}

export async function requestPhoto(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "").trim();
  const batchLocationId = String(formData.get("batchLocationId") ?? "").trim() || null;
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!batchId) {
    redirect(`/poisk?photoErr=${encodeURIComponent("Не указана партия")}`);
  }

  const managerId = await currentManagerId();
  if (!managerId) {
    redirect(
      `/poisk?photoErr=${encodeURIComponent("Менеджер не найден — выполните заполнение базы (seed)")}`,
    );
  }

  try {
    await createAndDispatchPhotoRequest(
      { managerId, batchId, batchLocationId, comment },
      { db, sendMessage },
    );
  } catch (e) {
    if (e instanceof PhotoRequestError) {
      redirect(`/poisk?photoErr=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }

  redirect("/poisk?photo=ok");
}
