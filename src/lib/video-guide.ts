// ТЗ №21 §3.4 — ссылка «Видеоинструкция»: видео той роли, под которой вошли.
// Складчик видит видео зав. складом. У партнёра видео нет — ссылки нет.
// Файлы собирает `npm run video:build` (video/remotion), лежат в public/video/.

import type { Role } from "@/lib/permissions";

const FILES: Partial<Record<Role, string>> = {
  OWNER: "onyx-vladelets.mp4",
  MANAGER: "onyx-menedzher.mp4",
  WAREHOUSE_LEAD: "onyx-zavsklad.mp4",
  WAREHOUSE: "onyx-zavsklad.mp4",
};

export function videoGuideHref(role: Role): string | null {
  const f = FILES[role];
  return f ? `/video/${f}` : null;
}
