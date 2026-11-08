// ТЗ №20 L (§13.1) — типы партнёра и подписи. Отдельный модуль без БД:
// его импортирует и клиентская форма продажи.
import type { PartnerType } from "@prisma/client";

export const PARTNER_TYPES: readonly PartnerType[] = ["DESIGNER", "FOREMAN", "CONTRACTOR"] as const;

export const PARTNER_TYPE_RU: Record<PartnerType, string> = {
  DESIGNER: "Дизайнер",
  FOREMAN: "Прораб",
  CONTRACTOR: "Подрядчик",
};

export function isPartnerType(v: unknown): v is PartnerType {
  return typeof v === "string" && (PARTNER_TYPES as readonly string[]).includes(v);
}
