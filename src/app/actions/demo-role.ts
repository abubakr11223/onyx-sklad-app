"use server";

// R1 — DEMO rol almashtirgich server action'i.
// ⚠️ DEMO-ONLY: sayt «kodsiz» ochiq turganda har bir rolni ko'rsatish uchun
// `onyx_demo_role` cookie'sini o'rnatadi. R6'da (haqiqiy login) bu action
// BUTUNLAY OLIB TASHLANADI — rol login orqali aniqlanadi.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DEMO_ROLE_COOKIE } from "@/lib/session";

const VALID_ROLES = ["OWNER", "MANAGER", "WAREHOUSE", "PARTNER"] as const;
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

/**
 * Demo-rolni cookie'ga yozadi (noto'g'ri qiymat — jim e'tiborsiz qoldiriladi)
 * va bosh sahifani qayta validatsiya qiladi, shunda yangi rol darhol amal qiladi.
 */
export async function setDemoRole(role: string): Promise<void> {
  if (!(VALID_ROLES as readonly string[]).includes(role)) return;

  const store = await cookies();
  store.set(DEMO_ROLE_COOKIE, role, {
    path: "/",
    sameSite: "lax",
    maxAge: THIRTY_DAYS_S,
  });

  revalidatePath("/");
}
