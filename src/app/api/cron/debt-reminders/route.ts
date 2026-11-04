// ТЗ №20 D (§5) — ежедневные напоминания о долгах в Telegram.
//
// Vercel Cron (vercel.json → crons) вызывает в 04:00 UTC = 09:00 по Ташкенту:
// «завтра срок» менеджеру, просрочка (1/7/30 дней) менеджеру и владельцу,
// сводка владельцу. Вся логика и идемпотентность — src/lib/debt-reminders.ts;
// повторный или запоздалый вызов не шлёт одно и то же дважды.
//
// Безопасность: `Authorization: Bearer ${CRON_SECRET}` (lib/cron-auth, как у
// /api/cron/backup). Нет секрета / не совпал → 401, база не трогается.
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { prismaReminderStore, runDebtReminders } from "@/lib/debt-reminders";
import { publicBaseUrl } from "@/lib/qr";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** База ссылок: APP_BASE_URL (как у magic-link бота), иначе домен приложения. */
function baseUrl(): string {
  const raw = (process.env.APP_BASE_URL ?? "").trim();
  return (/^https?:\/\/\S+$/i.test(raw) ? raw : publicBaseUrl()).replace(/\/+$/, "");
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "cron/debt-reminders")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const stats = await runDebtReminders({
    store: prismaReminderStore(db),
    sendMessage: (chatId, text) => sendMessage(chatId, text),
    now: new Date(),
    baseUrl: baseUrl(),
  });
  console.info(`[cron/debt-reminders] ${JSON.stringify(stats)}`);
  return Response.json({ ok: true, ...stats });
}
