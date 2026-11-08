"use server";

// ТЗ №20 K (§12.2–12.4) — «Спросить ИИ» и «Найти по фото» в каталоге (и из
// «Поиска» сотрудника). Результат — обычная страница /katalog с фильтрами,
// которые понял ИИ (чипы над результатом можно убрать или изменить).
// Сотрудник — без лимита; клиент и партнёр — 20 ИИ-запросов в час с IP.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { viewerForRole } from "@/lib/public-card";
import { AI_PHOTO_MAX_BYTES, aiPhotoSearch, aiTextSearch } from "@/lib/ai-search";

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const first = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
    return (first || (h.get("x-real-ip") ?? "").trim()).slice(0, 64);
  } catch {
    return "";
  }
}

async function who() {
  const user = await getCurrentUser().catch(() => null);
  const viewer = viewerForRole(user?.role);
  return { viewer, channel: viewer === "staff" ? ("STAFF" as const) : ("CATALOG" as const) };
}

export async function aiTextSearchAction(formData: FormData): Promise<void> {
  const text = String(formData.get("ai") ?? "").trim();
  if (!text) redirect("/katalog");
  const { viewer, channel } = await who();
  const res = await aiTextSearch(db, { text, viewer, channel, ip: await clientIp() });
  redirect(`/katalog?${res.params.toString()}#results`);
}

export async function aiPhotoSearchAction(formData: FormData): Promise<void> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0 || !file.type.startsWith("image/")) {
    redirect("/katalog?aiPhoto=bad");
  }
  if (file.size > AI_PHOTO_MAX_BYTES) redirect("/katalog?aiPhoto=big");
  const { viewer, channel } = await who();
  const res = await aiPhotoSearch(db, {
    bytes: Buffer.from(await file.arrayBuffer()),
    viewer,
    channel,
    ip: await clientIp(),
  });
  redirect(`/katalog?${res.params.toString()}#results`);
}
