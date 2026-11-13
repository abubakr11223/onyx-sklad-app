// ТЗ №20 H (§9.2) — «Бот»: состояние вебхука Telegram для владельца.
// Показывает, куда Telegram шлёт обновления, какие типы и последнюю ошибку.
// Если нет callback_query — кнопка «Менеджер связался» не дойдёт до сайта;
// здесь же это можно исправить одной кнопкой. Токен бота не показывается.
import type { Metadata } from "next";
import Link from "next/link";
import { getRealSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { maskTelegramId } from "@/lib/public-lead";
import { getWebhookInfo } from "@/lib/telegram";
import { isOurWebhookUrl, missingUpdates, REQUIRED_UPDATES } from "@/lib/telegram-bot-setup";
import { formatTashkentDateTime } from "@/lib/datetime";
import { appHosts } from "./hosts";
import { fixBotUpdates } from "./actions";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Бот — Onyx" };

const ERR: Record<string, string> = {
  denied: "Только владелец.",
  info: "Telegram не ответил — попробуйте позже.",
  foreign: "Вебхук ведёт не на этот сайт — менять не стали.",
  nosecret: "На сервере не задан TELEGRAM_WEBHOOK_SECRET — менять нельзя (сломается проверка).",
  set: "Telegram не принял изменение — попробуйте позже.",
};
const OK: Record<string, string> = {
  fixed: "Готово: Telegram теперь присылает нажатия кнопок. Проверьте «Менеджер связался» на новой заявке.",
  already: "Нажатия кнопок уже включены — менять нечего.",
};

export default async function BotPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const me = await getRealSessionUser();
  if (!me || me.role !== "OWNER") {
    return (
      <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const sp = await searchParams;
  const [info, staff] = await Promise.all([
    getWebhookInfo(),
    // Кому уходят уведомления о заявках и кто может нажать «Менеджер связался».
    db.user.findMany({
      where: { role: { in: ["OWNER", "MANAGER"] } },
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true, isActive: true, telegramId: true },
    }),
  ]);
  const w = info.ok ? info.result : null;
  const missing = w ? missingUpdates(w.allowed_updates) : [];
  const ours = w ? isOurWebhookUrl(w.url, appHosts()) : false;
  let host = "";
  try {
    host = w?.url ? new URL(w.url).host + new URL(w.url).pathname : "";
  } catch {
    host = "";
  }

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
      <p className="text-sm">
        <Link href="/accounts" className="text-gold-deep underline">
          ← Сотрудники
        </Link>
      </p>
      <h1 className="mt-1 text-display font-semibold text-ink">Бот</h1>
      <p className="mt-1 text-sm text-ink-2">
        Куда Telegram присылает сообщения бота и нажатия кнопок. Нужно для «Менеджер связался»
        под уведомлением о заявке.
      </p>

      {sp.ok && OK[sp.ok] && (
        <Alert variant="success" className="mt-4">
          {OK[sp.ok]}
        </Alert>
      )}
      {sp.err && (
        <Alert variant="danger" className="mt-4">
          {ERR[sp.err] ?? "Не удалось выполнить."}
        </Alert>
      )}

      <Card className="mt-4">
        {!w ? (
          <p className="text-sm text-danger">
            Не удалось получить состояние бота{info.ok ? "" : ` (${info.error.slice(0, 80)})`}.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-2">Адрес вебхука</dt>
            <dd className="break-all text-ink">
              {host || "не задан"}{" "}
              {host && <Badge variant={ours ? "success" : "warning"}>{ours ? "этот сайт" : "не этот сайт"}</Badge>}
            </dd>
            <dt className="text-ink-2">Типы обновлений</dt>
            <dd className="text-ink">
              {w.allowed_updates && w.allowed_updates.length > 0 ? w.allowed_updates.join(", ") : "все обычные (по умолчанию)"}
            </dd>
            <dt className="text-ink-2">Нажатия кнопок</dt>
            <dd>
              {missing.includes("callback_query") ? (
                <Badge variant="warning">не приходят</Badge>
              ) : (
                <Badge variant="success">приходят</Badge>
              )}
            </dd>
            <dt className="text-ink-2">В очереди</dt>
            <dd className="tnum text-ink">{w.pending_update_count ?? 0}</dd>
            <dt className="text-ink-2">Последняя ошибка</dt>
            <dd className="text-ink">
              {w.last_error_message
                ? `${w.last_error_message}${w.last_error_date ? ` · ${formatTashkentDateTime(new Date(w.last_error_date * 1000))}` : ""}`
                : "нет"}
            </dd>
          </dl>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="text-base font-semibold text-ink">Кто получает заявки и может нажать «Менеджер связался»</h2>
        <p className="mt-1 text-sm text-ink-2">
          Активные менеджеры и владелец с привязанным Telegram. Если человек получает
          уведомления, но кнопка отвечает «Заявки берут менеджеры и владелец», — его Telegram
          привязан к другому (или отключённому) аккаунту: проверьте в «Сотрудниках».
        </p>
        <ul className="mt-3 divide-y divide-line rounded-card border border-line text-sm">
          {staff.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
              <span className="text-ink">
                {u.name} <span className="text-ink-2">· {u.role === "OWNER" ? "владелец" : "менеджер"}</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {!u.isActive && <Badge variant="neutral">отключён</Badge>}
                {u.telegramId ? (
                  <Badge variant="success">Telegram {maskTelegramId(u.telegramId)}</Badge>
                ) : (
                  <Badge variant="warning">Telegram не привязан</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {w && missing.length > 0 && ours && (
        <Card className="mt-4">
          <p className="text-sm text-ink-2">
            Не хватает: {missing.join(", ")}. Кнопка ниже оставит адрес и секрет как есть и добавит
            недостающие типы ({REQUIRED_UPDATES.join(", ")}).
          </p>
          <form action={fixBotUpdates} className="mt-3">
            <Button type="submit">Включить нажатия кнопок</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
