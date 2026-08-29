// «Заявки» (A1, TZ §6.8) — очередь лидов дизайнеров/партнёров. Партнёр смотрит
// камень и запрашивает объём → каждый запрос становится Lead(NEW) и попадает
// сюда («ни один интерес не теряется», §6.8.5). Менеджер связывается и ведёт
// заявку по статусу NEW → CONTACTED → CLOSED.
//
// Ролевой гейт (defense-in-depth, как /istoriya): canSeeLeads (OWNER/MANAGER).
// Складчик и партнёр → <NoAccess/>. Server component; force-dynamic.

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDateTime } from "@/lib/datetime";
import {
  LEAD_KIND_RU,
  LEAD_STATUS_FLOW,
  LEAD_STATUS_RU,
  LEADS_PAGE_SIZE,
  isLeadStatus,
  type LeadKind,
  type LeadStatus,
  listLeadsPage,
} from "@/lib/leads";
import { advanceLead } from "./actions";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Заявки — Onyx",
};

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

// Статус → «настроение» badge: NEW требует внимания (warning), CONTACTED в
// работе (neutral), CLOSED завершена (success).
const STATUS_VARIANT: Record<LeadStatus, "warning" | "neutral" | "success"> = {
  NEW: "warning",
  CONTACTED: "neutral",
  CLOSED: "success",
};

// W8-A: VIEW (passive) must never look like REQUEST (explicit).
const KIND_VARIANT: Record<LeadKind, "neutral" | "warning"> = {
  REQUEST: "warning",
  VIEW: "neutral",
};

// Подпись кнопки перехода в конкретный статус (действие, не название статуса).
const TRANSITION_LABEL: Record<LeadStatus, string> = {
  NEW: "Вернуть в новые",
  CONTACTED: "Связался",
  CLOSED: "Закрыть",
};

const ERROR_RU: Record<string, string> = {
  denied: "Недостаточно прав.",
  notfound: "Заявка не найдена.",
  status: "Недопустимый статус.",
  transition: "Такой переход статуса недоступен.",
};

const OK_RU: Record<string, string> = {
  updated: "Статус заявки обновлён.",
};

export default async function ZayavkiPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    status?: string;
    after?: string;
  }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeLeads) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const okMsg = sp.ok ? OK_RU[sp.ok] : undefined;
  const errMsg = sp.error ? (ERROR_RU[sp.error] ?? "Не удалось выполнить действие.") : undefined;

  const statusRaw = (sp.status ?? "").trim();
  const status = isLeadStatus(statusRaw) ? statusRaw : undefined;
  // W3-T5 — keyset-курсор (status+createdAt+id). Раньше очередь обрывалась на
  // 200-й заявке молча: следующей ссылки не было вовсе.
  const after = (sp.after ?? "").trim() || null;

  const page = await listLeadsPage(db, {
    status,
    cursor: after,
    pageSize: LEADS_PAGE_SIZE,
  });
  const leads = page.items;

  // Ссылка «Показать ещё» несёт фильтр, но НЕ несёт ok/error: флеш-сообщение
  // о прошлом действии не должно всплывать заново на второй странице.
  const buildHref = (over: { after?: string }) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (over.after) p.set("after", over.after);
    const s = p.toString();
    return "/zayavki" + (s ? `?${s}` : "");
  };

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · заявки
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Заявки
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Запросы и просмотры дизайнеров-партнёров. «Заявка» — явный запрос
          объёма; «Интерес (посмотрел)» — открыл карточку, объём не заказывал.
          Ни один интерес не теряется.
        </p>
      </header>

      {okMsg && (
        <Alert variant="success" className="mb-4">
          {okMsg}
        </Alert>
      )}
      {errMsg && (
        <Alert variant="danger" className="mb-4">
          {errMsg}
        </Alert>
      )}

      {/* GET-форма: фильтр остаётся в ссылке. Отправка формы сбрасывает
          курсор — новый фильтр всегда начинается с первой страницы. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink/70">
          Статус
          <select
            name="status"
            defaultValue={status ?? ""}
            className={inputClass}
          >
            <option value="">Все</option>
            <option value="NEW">{LEAD_STATUS_RU.NEW}</option>
            <option value="CONTACTED">{LEAD_STATUS_RU.CONTACTED}</option>
            <option value="CLOSED">{LEAD_STATUS_RU.CLOSED}</option>
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Показать
        </Button>
      </form>

      {leads.length === 0 ? (
        <Card>
          <p className="text-sm text-ink/60">
            {status
              ? `Заявок со статусом «${LEAD_STATUS_RU[status]}» нет.`
              : "Заявок пока нет."}
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {leads.map((l) => {
            const nextStatuses = LEAD_STATUS_FLOW[l.status];
            return (
              <li key={l.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {l.stoneType ? (
                          <Link
                            href={"/kamen/" + l.stoneType.id}
                            className="text-gold-deep hover:underline"
                          >
                            {l.stoneType.name}
                          </Link>
                        ) : (
                          <span className="text-ink/60">Вид не указан</span>
                        )}
                      </p>
                      <p className="text-sm text-ink/60">
                        От: {l.createdBy.name}
                        {l.assignedManager && (
                          <> · ведёт: {l.assignedManager.name}</>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={KIND_VARIANT[l.kind]}>
                        {LEAD_KIND_RU[l.kind]}
                      </Badge>
                      <Badge variant={STATUS_VARIANT[l.status]}>
                        {LEAD_STATUS_RU[l.status]}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-ink/70">
                    {l.kind === "VIEW" ? (
                      <p className="text-ink/60">
                        Просмотр карточки — объём не запрашивал. Перезвоните:
                        «Вы интересовались таким камнем?»
                      </p>
                    ) : (
                      <p>
                        <span className="text-ink/55">Запрос:</span>{" "}
                        {l.requestedSlabs === null &&
                        l.requestedAreaM2 === null ? (
                          <span className="text-ink/50">объём не указан</span>
                        ) : (
                          [
                            l.requestedSlabs !== null
                              ? `${l.requestedSlabs} плит`
                              : null,
                            l.requestedAreaM2 !== null
                              ? `≈${m2Fmt.format(Number(l.requestedAreaM2))} м²`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        )}
                      </p>
                    )}
                    {l.contact && (
                      <p>
                        <span className="text-ink/55">Контакт:</span> {l.contact}
                      </p>
                    )}
                    {l.note && (
                      <p className="whitespace-pre-line">
                        <span className="text-ink/55">Комментарий:</span> {l.note}
                      </p>
                    )}
                    <p className="text-xs text-ink/50">
                      {formatTashkentDateTime(l.createdAt)}
                    </p>
                  </div>

                  {nextStatuses.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-ink/10 pt-4">
                      {nextStatuses.map((to) => (
                        <form key={to} action={advanceLead}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="status" value={to} />
                          <Button type="submit" variant="secondary" size="sm">
                            {TRANSITION_LABEL[to]}
                          </Button>
                        </form>
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Инвариант /poisk: ссылка есть ровно тогда, когда есть следующая строка. */}
      {page.nextCursor && (
        <div className="mt-4">
          <Link
            href={buildHref({ after: page.nextCursor })}
            className={buttonClass("secondary", "sm")}
          >
            Показать ещё →
          </Link>
        </div>
      )}
    </main>
  );
}
