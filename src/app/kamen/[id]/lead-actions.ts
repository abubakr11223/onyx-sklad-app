"use server";

// A1 (TZ §6.8) — «Запросить объём»: server action партнёрского запроса. Логика
// создания лида — в src/lib/leads.ts (переиспользуема ботом/менеджером); здесь
// только разбор формы, авторизация (только PARTNER-флоу) и маршрут ошибки в UI.
//
// Каждый запрос → Lead(NEW) для менеджера, поэтому «ни один интерес не теряется»
// (§6.8.5). Живём в отдельном файле рядом с page.tsx: страница — Server Component
// (не "use server"-модуль), а server action должен быть в "use server"-файле.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, requireCapabilityOrRedirect } from "@/lib/session";
import { createLead } from "@/lib/leads";
import { parsePositiveDecimal, parsePositiveInt } from "@/lib/validators/intake";

/**
 * Куда вернуться. По умолчанию /poisk. Защита от open-redirect: путь должен быть
 * локальным (та же проверка, что в poisk/actions.ts).
 */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) {
    return "/poisk";
  }
  return s;
}

export async function requestLead(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // Авторизация: «Запросить объём» — партнёрский флоу (requestsRouteToManager =
  // только PARTNER). OWNER/MANAGER продают напрямую и лидов не создают. Прямой
  // POST от другой роли блокируется на сервере, не только скрытием формы.
  await requireCapabilityOrRedirect(
    "requestsRouteToManager",
    `${next}?leadErr=${encodeURIComponent("Запрос объёма доступен дизайнеру-партнёру")}`,
  );

  const me = await getCurrentUser();
  if (!me) {
    redirect(
      `${next}?leadErr=${encodeURIComponent("Пользователь не найден — выполните заполнение базы (seed)")}`,
    );
  }

  const stoneTypeId = String(formData.get("stoneTypeId") ?? "").trim() || null;

  // N1: stoneTypeId опционален (интерес может быть без конкретного камня), но
  // если задан — камень должен существовать. Иначе createLead упрётся в FK
  // (P2003) и упадёт 500 на подделанном POST. Проверяем заранее — как
  // validateNewAccount: нет камня → ошибка поля, не краш.
  if (stoneTypeId) {
    const exists = await db.stoneType.findUnique({
      where: { id: stoneTypeId },
      select: { id: true },
    });
    if (!exists) {
      redirect(`${next}?leadErr=${encodeURIComponent("Камень не найден")}`);
    }
  }

  // Объём опционален (интерес может быть без точного количества), но если задан —
  // должен быть корректным положительным числом (иначе ошибка поля, не 500).
  const slabs = parsePositiveInt(String(formData.get("requestedSlabs") ?? ""));
  if (slabs === undefined) {
    redirect(`${next}?leadErr=${encodeURIComponent("Плиты — целое положительное число")}`);
  }
  const area = parsePositiveDecimal(String(formData.get("requestedAreaM2") ?? ""));
  if (area === undefined) {
    redirect(`${next}?leadErr=${encodeURIComponent("Площадь — положительное число, например 12,5")}`);
  }

  const contact = String(formData.get("contact") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  await createLead(db, {
    createdById: me.id,
    stoneTypeId,
    requestedSlabs: slabs ?? null,
    requestedAreaM2: area ?? null,
    contact,
    note,
  });

  redirect(`${next}?lead=ok`);
}
