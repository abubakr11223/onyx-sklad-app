// TZ №9 Part B — «Должники» (owner-only). Domain: listDebts / debtSummary / repayDebt.
// Currency rule: never combine UZS + USD (CONTRACT.md).

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import {
  debtSummary,
  listDebts,
  type DebtListItem,
} from "@/lib/debts";
import {
  DEBT_PAGE_SIZE,
  formatCurrencySummaryLine,
  formatDebtMoney,
  formatDebtPurchase,
  formatRevenueByMethod,
  groupDebtsByClient,
  type PaymentMethodKey,
  type RevenueByMethodRow,
} from "@/lib/debts-ui";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Field, { inputClass } from "@/components/ui/Field";
import { repayDebtAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Должники — Onyx",
};

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

const ERR_RU: Record<string, string> = {
  denied: "Недостаточно прав.",
  notfound: "Долг не найден.",
  already: "Долг уже погашен.",
  inactive: "Долг не активен.",
  date: "Укажите корректную дату погашения.",
  fail: "Не удалось погасить долг.",
};

const OK_RU: Record<string, string> = {
  repaid: "Долг погашен.",
};

async function loadRevenueByMethod(): Promise<RevenueByMethodRow[]> {
  // §9.2 — выручка по способам оплаты (owner analytics). Bounded groupBy.
  const groups = await db.saleRecord.groupBy({
    by: ["paymentMethod", "currency"],
    where: {
      returnedAt: null,
      paymentMethod: { not: null },
      currency: { not: null },
      price: { not: null },
    },
    _sum: { price: true },
    _count: { _all: true },
  });

  const out: RevenueByMethodRow[] = [];
  for (const g of groups) {
    if (!g.paymentMethod || !g.currency) continue;
    const method = g.paymentMethod as PaymentMethodKey;
    if (method !== "CASH" && method !== "CARD" && method !== "CREDIT") continue;
    const cur = g.currency as "UZS" | "USD";
    if (cur !== "UZS" && cur !== "USD") continue;
    const sum = g._sum.price;
    if (!sum || g._count._all <= 0) continue;
    out.push({
      method,
      currency: cur,
      amount: sum.toString(),
      count: g._count._all,
    });
  }
  return out;
}

function DebtCard({
  d,
  tab,
  returnTo,
}: {
  d: DebtListItem;
  tab: string;
  returnTo: string;
}) {
  return (
    <li className="rounded-card border border-line bg-paper p-3 text-sm text-ink/80">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-ink">{d.sale.customerName}</span>
          {d.sale.customerContact && (
            <span className="ml-2 text-ink/60">{d.sale.customerContact}</span>
          )}
        </div>
        <span className="tnum font-semibold text-ink">
          {formatDebtMoney(d.amount, d.currency)}
        </span>
      </div>
      <p className="mt-1 text-ink/70">{formatDebtPurchase(d.sale)}</p>
      <p className="mt-1 text-ink/55">
        Продажа {formatTashkentDate(d.sale.soldAt)}
        {d.dueDate && (
          <>
            {" "}
            · срок {formatTashkentDate(d.dueDate)}
            {d.overdue && (
              <Badge variant="warning" className="ml-1.5 align-middle">
                просрочен
              </Badge>
            )}
          </>
        )}
        {" · "}
        {d.sale.managerName}
      </p>
      {d.comment && (
        <p className="mt-1 text-xs text-ink/50">Комментарий: {d.comment}</p>
      )}
      {tab === "active" && d.status === "ACTIVE" && (
        <form action={repayDebtAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="debtId" value={d.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="flex flex-col gap-0.5 text-xs text-ink/60">
            Дата погашения
            <input
              type="date"
              name="repaidAt"
              className={inputClass + " min-h-10 w-40 text-sm"}
              required
            />
          </label>
          <Button type="submit" size="sm" variant="primary">
            Погасить долг
          </Button>
        </form>
      )}
      {tab === "repaid" && d.repaidAt && (
        <p className="mt-1 text-success">
          Погашен {formatTashkentDate(d.repaidAt)}
          {d.repaidAmount && (
            <> · {formatDebtMoney(d.repaidAmount, d.currency)}</>
          )}
        </p>
      )}
    </li>
  );
}

export default async function DolzhnikiPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  // Defense-in-depth: capability gate (same idea as /accounts OWNER-only).
  const caps = await getCapabilities();
  if (!caps.canSeeDebts) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const tab = first(sp.tab) === "repaid" ? "repaid" : "active";
  const q = first(sp.q);
  const managerId = first(sp.managerId) || undefined;
  const overdueOnly = first(sp.overdue) === "1";
  const currencyRaw = first(sp.currency);
  const currency =
    currencyRaw === "UZS" || currencyRaw === "USD" ? currencyRaw : undefined;
  const after = first(sp.after) || null;
  const ok = first(sp.ok);
  const err = first(sp.err);

  const now = new Date();

  const [summary, list, managers, revenue] = await Promise.all([
    debtSummary(db, { now }),
    listDebts(db, {
      status: tab === "repaid" ? "REPAID" : "ACTIVE",
      q: q || undefined,
      managerId,
      overdueOnly: tab === "active" ? overdueOnly : false,
      currency,
      cursor: after,
      pageSize: DEBT_PAGE_SIZE,
      now,
    }),
    db.user.findMany({
      where: { role: { in: ["OWNER", "MANAGER"] }, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 200,
    }),
    loadRevenueByMethod(),
  ]);

  const groups = groupDebtsByClient(list.items);
  const hasMore = list.nextCursor != null;

  const buildHref = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const tabV = over.tab ?? tab;
    if (tabV !== "active") p.set("tab", tabV);
    const qV = over.q !== undefined ? over.q : q;
    if (qV) p.set("q", qV);
    const mV = over.managerId !== undefined ? over.managerId : managerId;
    if (mV) p.set("managerId", mV);
    const oV = over.overdue !== undefined ? over.overdue : overdueOnly ? "1" : "";
    if (oV === "1") p.set("overdue", "1");
    const cV = over.currency !== undefined ? over.currency : currency;
    if (cV) p.set("currency", cV);
    if (over.after) p.set("after", over.after);
    const s = p.toString();
    return "/dolzhniki" + (s ? `?${s}` : "");
  };

  const returnTo = buildHref({});

  const activeLine = formatCurrencySummaryLine(summary.activeByCurrency);
  const overdueLine = formatCurrencySummaryLine(summary.overdueByCurrency);
  const overdueCount = summary.overdueByCurrency.reduce((n, r) => n + r.count, 0);
  const revenueLines = formatRevenueByMethod(revenue);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · владелец
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Должники
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Продажи «в долг»: кто должен, сколько, когда вернуть. Суммы — по
          валютам отдельно (сум и $ не складываются).
        </p>
      </header>

      {ok && OK_RU[ok] && (
        <Alert variant="success" className="mb-4">
          {OK_RU[ok]}
        </Alert>
      )}
      {err && (
        <Alert variant="danger" className="mb-4">
          {ERR_RU[err] ?? "Ошибка."}
        </Alert>
      )}

      {/* Summary — per currency, omit empty */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Активные долги
          </p>
          <p className="tnum mt-1 text-lg font-bold text-ink">
            {activeLine ?? "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Должников
          </p>
          <p className="tnum mt-1 text-lg font-bold text-ink">
            {summary.activeDebtorCount}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Просрочено
          </p>
          <p className="tnum mt-1 text-lg font-bold text-ink">
            {overdueLine ?? "—"}
          </p>
          {overdueCount > 0 && (
            <p className="mt-0.5 text-xs text-warning">
              {overdueCount}{" "}
              {overdueCount === 1 ? "долг" : "долгов"}
            </p>
          )}
        </Card>
      </div>

      {/* §9.2 revenue by payment method */}
      {revenueLines.length > 0 && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-ink">
            Выручка по способам оплаты
          </h2>
          <p className="mt-0.5 text-xs text-ink/50">
            Все невозвращённые продажи с указанным способом. По валютам
            отдельно.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink/80">
            {revenueLines.map((r) => (
              <li key={r.methodRu} className="flex flex-wrap justify-between gap-2">
                <span>{r.methodRu}</span>
                <span className="tnum font-medium text-ink">{r.line}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <Link
          href={buildHref({ tab: "active", after: undefined })}
          className={buttonClass(
            tab === "active" ? "primary" : "secondary",
            "sm",
          )}
        >
          Активные
        </Link>
        <Link
          href={buildHref({ tab: "repaid", after: undefined, overdue: "" })}
          className={buttonClass(
            tab === "repaid" ? "primary" : "secondary",
            "sm",
          )}
        >
          Погашенные
        </Link>
      </div>

      {/* Filters §9.1 */}
      <Card className="mb-6">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {tab === "repaid" && <input type="hidden" name="tab" value="repaid" />}
          <Field id="q" label="Клиент">
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="имя или телефон"
              className={inputClass}
            />
          </Field>
          <Field id="managerId" label="Менеджер">
            <select
              id="managerId"
              name="managerId"
              defaultValue={managerId ?? ""}
              className={inputClass}
            >
              <option value="">Все</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="currency" label="Валюта">
            <select
              id="currency"
              name="currency"
              defaultValue={currency ?? ""}
              className={inputClass}
            >
              <option value="">Все</option>
              <option value="UZS">Сум</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          {tab === "active" && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="overdue"
                value="1"
                defaultChecked={overdueOnly}
                className="h-5 w-5 accent-ink"
              />
              Только просроченные
            </label>
          )}
          <Button type="submit" size="sm" variant="secondary">
            Применить
          </Button>
        </form>
      </Card>

      {list.items.length === 0 ? (
        <p className="text-ink/60">
          {tab === "active"
            ? "Активных долгов нет."
            : "Погашенных долгов пока нет."}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              {g.debts.length > 1 && (
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-bold text-ink">
                    {g.customerName}
                    {g.customerContact && (
                      <span className="ml-2 text-sm font-normal text-ink/55">
                        {g.customerContact}
                      </span>
                    )}
                  </h2>
                  <p className="tnum text-sm font-semibold text-ink">
                    Итого:{" "}
                    {formatCurrencySummaryLine(g.totalsByCurrency) ?? "—"}
                  </p>
                </div>
              )}
              <ul className="space-y-2">
                {g.debts.map((d) => (
                  <DebtCard
                    key={d.id}
                    d={d}
                    tab={tab}
                    returnTo={returnTo}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {hasMore && list.nextCursor && (
        <div className="mt-6">
          <Link
            href={buildHref({ after: list.nextCursor })}
            className={buttonClass("secondary", "sm")}
          >
            Показать ещё →
          </Link>
        </div>
      )}
    </main>
  );
}
