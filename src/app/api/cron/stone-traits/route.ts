// ТЗ №20 K (§12.1) — фоновый пересчёт признаков камня по фото.
//
// Vercel Cron раз в сутки (22:30 UTC = 03:30 по Ташкенту): цели без признаков
// (первый пересчёт после внедрения идёт порциями по несколько ночей) и узоры с
// новым фото. Ручные правки (MANUAL) не трогает. Не больше TRAITS_PER_RUN
// обращений к ИИ за запуск — укладываемся во время функции.
//
// Безопасность: `Authorization: Bearer ${CRON_SECRET}` (lib/cron-auth).
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { refreshTraitsBacklog } from "@/lib/traits-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TRAITS_PER_RUN = 40;

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "cron/stone-traits")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const stats = await refreshTraitsBacklog(db, { limit: TRAITS_PER_RUN });
  console.info(`[cron/stone-traits] ${JSON.stringify(stats)}`);
  return Response.json({ ok: true, ...stats });
}
