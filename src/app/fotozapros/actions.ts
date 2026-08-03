"use server";

// TG-B / §6.1 — fotozaprosni «Готово» bilan yopish (server action).
// §6.1 bo'yicha bir zapros N plita to'playdi: foto tushganda zapros DONE
// BO'LMAYDI (PENDING qolib ketma-ket plitalarni qabul qiladi). Menejer plitalar
// yetarli deb hisoblaganda shu amal bilan zaprosni yopadi (PENDING → DONE).
//
// Logika sodda (§9): faqat status yangilash. Avtorizatsiya — canRequestPhoto
// (OWNER/MANAGER), poisk/actions.ts uslubidagi defense-in-depth.
//
// Bulk close: bir nechta PENDING → DONE (o‘chirish EMAS). Bot FIFO qoidasiga
// tegmaydi — faqat ochiq navbatni qisqartiradi (owner tanlovi: tugma, auto-expiry yo‘q).
//
// Pure helpers: ./bulk-close.ts (NOT re-exported from this file — "use server"
// modules may only export async actions).

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { bulkCloseWhere, parseBulkCloseForm } from "./bulk-close";

export async function closePhotoRequest(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();

  // Defense-in-depth: zaprosni yopish — canRequestPhoto (OWNER/MANAGER). Skladchi
  // fotolaydi, ammo zaprosni menejer yopadi. To'g'ridan-to'g'ri POST bloklanadi.
  if (!(await getCapabilities()).canRequestPhoto) {
    redirect(
      `/fotozapros?closeErr=${encodeURIComponent("Нет доступа: закрытие запроса доступно менеджеру")}`,
    );
  }

  if (!id) {
    redirect(`/fotozapros?closeErr=${encodeURIComponent("Не указан запрос")}`);
  }

  // Faqat PENDING → DONE (idempotent: allaqachon DONE/CANCELLED bo'lsa updateMany
  // count=0 — xatosiz, redirect baribir bo'ladi). completedAt yopilgan paytni yozadi.
  await db.photoRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "DONE", completedAt: new Date() },
  });

  redirect("/fotozapros?closed=ok");
}

/**
 * Bulk: all matching PENDING → DONE + completedAt (same semantics as single close).
 * Requires confirm token + ack. Scope default «older» is safer than «all».
 */
export async function bulkClosePhotoRequests(
  formData: FormData,
): Promise<void> {
  if (!(await getCapabilities()).canRequestPhoto) {
    redirect(
      `/fotozapros?closeErr=${encodeURIComponent("Нет доступа: закрытие запроса доступно менеджеру")}`,
    );
  }

  const parsed = parseBulkCloseForm(formData);
  if (!parsed.ok) {
    redirect(`/fotozapros?closeErr=${encodeURIComponent(parsed.error)}`);
  }

  const where = bulkCloseWhere(parsed.scope, parsed.olderThanDays);
  const result = await db.photoRequest.updateMany({
    where,
    data: { status: "DONE", completedAt: new Date() },
  });

  redirect(
    `/fotozapros?closed=bulk&n=${result.count}&scope=${parsed.scope}`,
  );
}
