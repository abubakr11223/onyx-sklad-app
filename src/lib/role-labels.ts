// BUG-06 — Rol nomlarining RU DISPLAY xaritasi (TZ §3 «Роли и права»).
// MUHIM: rol CODE (enum) — DOIM EN qoladi (wire/DB/permission mantiqiy kalit).
// Bu modul faqat KO'RSATISH uchun RU yorliq beradi. Mantiqni O'ZGARTIRMAYDI.
// `import type` — build'da o'chib ketadi, shuning uchun klient-import xavfsiz
// (permissions.ts DB'siz sof modul, lekin type-only bog'liqlik hech nima olib kelmaydi).

import type { Role } from "@/lib/permissions";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Владелец",
  MANAGER: "Менеджер",
  WAREHOUSE: "Складчик",
  WAREHOUSE_LEAD: "Зав. складом",
  PARTNER: "Дизайнер-партнёр",
};

export const roleLabel = (role: Role): string => ROLE_LABELS[role] ?? role;
