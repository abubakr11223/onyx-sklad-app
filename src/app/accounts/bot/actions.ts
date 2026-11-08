"use server";

// ТЗ №20 H (§9.2) — добавить callback_query в вебхук бота (кнопка
// «Менеджер связался»). Только владелец (реальная сессия). Адрес вебхука и
// секрет НЕ меняются: берём текущий адрес у Telegram, секрет — из окружения.
// Чужой адрес (не наш маршрут) не трогаем. Токен наружу не выходит.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getRealSessionUser } from "@/lib/session";
import { getWebhookInfo, setWebhookUpdates } from "@/lib/telegram";
import { isOurWebhookUrl, mergedUpdates, missingUpdates } from "@/lib/telegram-bot-setup";
import { appHosts } from "./hosts";

export async function fixBotUpdates(): Promise<void> {
  const me = await getRealSessionUser();
  if (!me || me.role !== "OWNER") redirect("/accounts/bot?err=denied");

  const info = await getWebhookInfo();
  if (!info.ok || !info.result) redirect("/accounts/bot?err=info");
  const current = info.result!;
  if (!isOurWebhookUrl(current.url, appHosts())) redirect("/accounts/bot?err=foreign");
  if (missingUpdates(current.allowed_updates).length === 0) redirect("/accounts/bot?ok=already");

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!secret) redirect("/accounts/bot?err=nosecret");

  const allowed = mergedUpdates(current.allowed_updates);
  const res = await setWebhookUpdates({ url: current.url, secretToken: secret, allowedUpdates: allowed });
  if (!res.ok) redirect("/accounts/bot?err=set");

  await db.auditLog.create({
    data: {
      userId: me!.id,
      action: "STATUS_CHANGE",
      entityType: "TelegramBot",
      entityId: "webhook",
      payload: { kind: "bot.allowed_updates", from: current.allowed_updates ?? [], to: allowed },
    },
  });
  redirect("/accounts/bot?ok=fixed");
}
