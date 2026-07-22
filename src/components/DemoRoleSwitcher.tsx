"use client";

// R1 — DEMO rol almashtirgich (kichik klient komponenti).
// ⚠️ DEMO-ONLY vaqtinchalik boshqaruv: sayt «kodsiz» ochiq turganda har rolni
// ko'rsatish uchun. Muted «pill» ko'rinishida — jiddiy UI emasligi bildiriladi.
// R6'da (haqiqiy login) OLIB TASHLANADI.
//
// Joriy rolni `document.cookie` dan o'qiydi (Nav — klient komponenti, cookie'ni
// server parent uzatmaydi — eng oddiy yechim shu). Almashtirilganda server
// action `setDemoRole` chaqiriladi; u cookie'ni yozib revalidatePath("/") qiladi.

import { useEffect, useState, useTransition } from "react";
import { setDemoRole } from "@/app/actions/demo-role";
import { roleLabel } from "@/lib/role-labels";

// Cookie nomi session.ts'dagi DEMO_ROLE_COOKIE bilan bir xil bo'lishi shart;
// bu server-only modulni klientga import qilmaslik uchun literal takrorlangan.
const DEMO_ROLE_COOKIE = "onyx_demo_role";
const ROLES = ["OWNER", "MANAGER", "WAREHOUSE", "PARTNER"] as const;
const DEFAULT_ROLE = "MANAGER";

function readCookieRole(): string {
  if (typeof document === "undefined") return DEFAULT_ROLE;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${DEMO_ROLE_COOKIE}=([^;]+)`),
  );
  const value = match ? decodeURIComponent(match[1]) : "";
  return (ROLES as readonly string[]).includes(value) ? value : DEFAULT_ROLE;
}

export default function DemoRoleSwitcher() {
  const [role, setRole] = useState<string>(DEFAULT_ROLE);
  const [isPending, startTransition] = useTransition();

  // Cookie faqat klientda o'qiladi (SSR/hidratsiya farqidan qochib, effektda).
  useEffect(() => {
    setRole(readCookieRole());
  }, []);

  return (
    <label
      className="flex w-full items-center gap-2 rounded-[10px] bg-side-2 px-3 py-1.5 text-xs text-side-muted ring-1 ring-white/10"
      title="Демо-режим: переключение роли (временно, будет убрано при входе по логину)"
    >
      <span className="whitespace-nowrap">Демо-роль</span>
      <select
        aria-label="Демо-роль"
        value={role}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          setRole(next);
          startTransition(() => {
            void setDemoRole(next);
          });
        }}
        className="min-h-11 flex-1 cursor-pointer bg-transparent font-semibold text-side-ink outline-none disabled:opacity-50 [&>option]:text-ink"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
    </label>
  );
}
