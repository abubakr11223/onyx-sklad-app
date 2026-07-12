// R2 — Rol majburlash: nav ko'rinishi uchun SOF surface→huquq xaritasi.
// permissions.ts uslubida: DB YO'Q, next YO'Q — toza lookup, alohida testlanadi.
// Nav (klient komponenti) shuni import qiladi, shu tufayli client-safe bo'lishi
// shart. ⚠️ Bu FAQAT kosmetik: haqiqiy majburlash — sahifa + action gate'lari.

import type { Capabilities } from "./permissions";

/**
 * Har bir nav yo'nalishi uchun talab qilinadigan huquq.
 * `null` — doim ko'rinadi (Поиск/Карта — barcha rollarga ochiq, TZ §3).
 * Xaritada yo'q yo'nalish ham doim ko'rinadi (deny-emas: nav — kosmetik).
 */
export const NAV_REQUIRED_CAPABILITY: Record<string, keyof Capabilities | null> = {
  "/priemka": "canManageWarehouse",
  "/poisk": null,
  "/bron": "canReserve",
  "/prodazha": "canSell",
  "/razbit": "canManageWarehouse",
  "/fotozapros": "canRequestPhoto",
  "/karta": null,
};

/** Joriy huquqlar bilan `href` nav'da ko'rinishi kerakmi (SOF). */
export function canAccessNav(href: string, caps: Capabilities): boolean {
  const key = NAV_REQUIRED_CAPABILITY[href];
  // null (doim ochiq) yoki xaritada yo'q (noma'lum yo'nalish) → ko'rsatamiz.
  return key == null ? true : caps[key];
}
