// TZ №9 Part B — «Должники» (owner-only). Domain: listDebts / debtSummary / repayDebt.
// Currency rule: never combine UZS + USD (CONTRACT.md).

import type { Metadata } from "next";
import Link from "next/link";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ui/EmptyState";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDate, todayTashkentISO } from "@/lib/datetime";
import { PAY_METHODS, PAY_METHOD_LABEL, type PayMethod } from "@/lib/payment-rows";
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
import { addDebtPaymentAction } from "./actions";

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
  amount: "Сумма платежа — положительное число, не больше остатка долга.",
};

const OK_RU: Record<string, string> = {
  repaid: "Долг погашен.",
  paid: "Платёж внесён.",
  clientpaid: "Платёж клиента разложен по долгам.",
};

async function loadRevenueByMethod(): Promise<RevenueByMethodRow[]> {
  // ТЗ №20 A §2.5 — выручка по способам считается по ПЛАТЕЖАМ (50/50 — две
  // строки по 5 млн), возвраты денег клиенту вычитаются. Bounded groupBy.
  const groups = await db.payment.groupBy({
    by: ["method", "currency", "kind"],
    _sum: { amount: true },
    _count: { _all: true },
  });

  const acc = new Map<string, { method: PaymentMethodKey; currency: "UZS" | "USD"; cents: number; count: number }>();
  for (const g of groups) {
    const method = g.method as PaymentMethodKey;
    if (method !== "CASH" && method !== "CARD" && method !== "TRANSFER") continue;
    const cur = g.currency as "UZS" | "USD";
    const key = `${method}:${cur}`;
    const row = acc.get(key) ?? { method, currency: cur, cents: 0, count: 0 };
    const cents = Math.round(Number(g._sum.amount ?? 0) * 100);
    if (g.kind === "REFUND") row.cents -= cents;
    else {
      row.cents += cents;
      row.count += g._count._all;
    }
    acc.set(key, row);
  }
  return [...acc.values()]
    .filter((r) => r.count > 0 && r.cents > 0)
    .map((r) => ({
      method: r.method,
      currency: r.currency,
      amount: (r.cents / 100).toFixed(2),
      count: r.count,
    }));
}

/** Форма платежа по долгу (ТЗ №20 A §2.3) — одна и та же для карточки и строки. */
function DebtPaymentForm({ d, returnTo }: { d: DebtListItem; returnTo: string }) {
  return (
    <form action={addDebtPaymentAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="debtId" value={d.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="flex flex-col gap-0.5 text-xs text-ink-2">
        Сумма
        {/* по умолчанию весь остаток — полное погашение в один клик */}
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={Number(d.remaining).toString()}
          className={inputClass + " tnum min-h-10 w-36 text-sm"}
          required
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-ink-2">
        Способ
        <select name="method" className={inputClass + " min-h-10 text-sm"} defaultValue="CASH">
          {PAY_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAY_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-ink-2">
        Дата
        <input
          type="date"
          name="paidAt"
          defaultValue={todayTashkentISO()}
          className={inputClass + " min-h-10 w-40 text-sm"}
          required
        />
      </label>
      <Button type="submit" size="sm" variant="primary">
        Внести
      </Button>
      {d.clientId && (
        <Link
          href={`/dolzhniki/klient/${d.clientId}?currency=${d.currency}`}
          className="text-xs text-honey-ink hover:underline"
        >
          Внести платёж клиента
        </Link>
      )}
    </form>
  );
}

/** История платежей по долгу и остаток. */
function DebtPayments({ d }: { d: DebtListItem }) {
  return (
    <>
      {/* ТЗ №20 A §2.3 — история платежей по долгу и остаток. */}
      {d.payments.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
          {d.payments.map((p, i) => (
            <li key={i} className="tnum">
              {formatTashkentDate(p.paidAt)} — {formatDebtMoney(p.amount, d.currency)}{" "}
              {PAY_METHOD_LABEL[p.method as PayMethod]?.toLowerCase() ?? p.method} ({p.receivedByName})
            </li>
          ))}
        </ul>
      )}
      {d.status === "ACTIVE" && d.payments.length > 0 && (
        <p className="tnum mt-1 font-semibold text-ink">
          Остаток: {formatDebtMoney(d.remaining, d.currency)}
        </p>
      )}
    </>
  );
}

/** Сетка колонок строки-таблицы (md+): клиент, покупка, сумма, срок, менеджер. */
const DEBT_GRID =
  "md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:gap-x-4";

function DebtTableHead() {
  return (
    <div
      aria-hidden="true"
      className={"hidden bg-stone-100 px-3 py-2 text-xs font-medium text-ink-2 " + DEBT_GRID}
    >
      <span>Клиент</span>
      <span>Покупка</span>
      <span className="text-right">Сумма долга</span>
      <span>Срок</span>
      <span>Менеджер</span>
    </div>
  );
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
    // id — якорь для ссылок из Telegram-напоминаний (ТЗ №20 D, lib/debt-reminders).
    <li
      id={`debt-${d.id}`}
      className="scroll-mt-4 rounded-card border border-line bg-marble p-4 text-sm text-ink target:border-honey md:rounded-none md:border-0 md:border-t md:border-line md:p-0 md:hover:bg-row-hover md:target:bg-honey-soft"
    >
      <div className="md:hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="font-semibold text-ink">{d.sale.customerName}</span>
            {d.sale.customerContact && (
              <span className="ml-2 text-ink-2">{d.sale.customerContact}</span>
            )}
          </div>
          <span className="tnum font-semibold text-carnelian">
            {formatDebtMoney(d.amount, d.currency)}
          </span>
        </div>
        <p className="mt-1 text-ink-2">{formatDebtPurchase(d.sale)}</p>
        <p className="mt-1 text-ink-2">
          Продажа {formatTashkentDate(d.sale.soldAt)}
          {d.dueDate && (
            <>
              {" "}
              · срок {formatTashkentDate(d.dueDate)}
              {d.overdue && (
                <Badge variant="danger" className="ml-1.5 align-middle">
                  просрочен
                </Badge>
              )}
            </>
          )}
          {" · "}
          {d.sale.managerName}
        </p>
        {d.comment && (
          <p className="mt-1 text-xs text-ink-3">Комментарий: {d.comment}</p>
        )}
        <DebtPayments d={d} />
        {tab === "active" && d.status === "ACTIVE" && (
          <div className="mt-3">
            <DebtPaymentForm d={d} returnTo={returnTo} />
          </div>
        )}
        {tab === "repaid" && d.repaidAt && (
          <p className="mt-1 text-malachite">
            Погашен {formatTashkentDate(d.repaidAt)}
            {d.repaidAmount && (
              <> · {formatDebtMoney(d.repaidAmount, d.currency)}</>
            )}
          </p>
        )}
      </div>
      {/* md+: строка таблицы (ТЗ №20 §8 «Должники»). Форма платежа — по
          «Принять оплату» (раскрывается под строкой), та же форма, что выше. */}
      <div className={"hidden items-baseline px-3 py-2.5 " + DEBT_GRID}>
        <div className="min-w-0">
          <span className="font-medium text-ink">{d.sale.customerName}</span>
          {d.sale.customerContact && (
            <span className="block truncate text-xs text-ink-2">{d.sale.customerContact}</span>
          )}
        </div>
        <div className="min-w-0 text-ink-2">
          {formatDebtPurchase(d.sale)}
          <span className="block text-xs">Продажа {formatTashkentDate(d.sale.soldAt)}</span>
          {d.comment && (
            <span className="block text-xs text-ink-3">Комментарий: {d.comment}</span>
          )}
        </div>
        <div className="text-right">
          <span className="tnum font-medium text-carnelian">
            {formatDebtMoney(d.amount, d.currency)}
          </span>
          {d.status === "ACTIVE" && d.payments.length > 0 && (
            <span className="tnum block text-xs text-ink">
              Остаток: {formatDebtMoney(d.remaining, d.currency)}
            </span>
          )}
          {tab === "repaid" && d.repaidAt && (
            <span className="block text-xs text-malachite">
              Погашен {formatTashkentDate(d.repaidAt)}
              {d.repaidAmount && <> · {formatDebtMoney(d.repaidAmount, d.currency)}</>}
            </span>
          )}
        </div>
        <div className="tnum text-ink-2">
          {d.dueDate ? formatTashkentDate(d.dueDate) : "—"}
          {d.overdue && (
            <Badge variant="danger" className="ml-1.5 align-middle">
              просрочен
            </Badge>
          )}
        </div>
        <div className="min-w-0 truncate text-ink-2">{d.sale.managerName}</div>
        {(d.payments.length > 0 || (tab === "active" && d.status === "ACTIVE")) && (
          <details className="col-span-full mt-1">
            <summary className="w-fit cursor-pointer text-sm text-honey-ink hover:underline">
              {tab === "active" && d.status === "ACTIVE" ? "Принять оплату" : "Платежи"}
            </summary>
            <DebtPayments d={d} />
            {tab === "active" && d.status === "ACTIVE" && (
              <div className="mt-3">
                <DebtPaymentForm d={d} returnTo={returnTo} />
              </div>
            )}
          </details>
        )}
      </div>
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
      <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
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

  const overdueLine = formatCurrencySummaryLine(summary.overdueByCurrency);
  const overdueCount = summary.overdueByCurrency.reduce((n, r) => n + r.count, 0);
  const revenueLines = formatRevenueByMethod(revenue);

  return (
    <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-6">
        <h1 className="text-display font-semibold text-ink">
          Должники
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Продажи «в долг»: кто должен, сколько, когда вернуть. Суммы — по
          валютам отдельно (сум и $ не складываются).
        </p>
      </header>

      {ok && (
        <Alert variant="success" className="mb-4">
          {OK_RU[ok] ?? "Готово."}
        </Alert>
      )}
      {err && (
        <Alert variant="danger" className="mb-4">
          {ERR_RU[err] ?? "Ошибка."}
        </Alert>
      )}

      {/* Итоги (ТЗ №20 §8 «Должники»): долг по валютам ОТДЕЛЬНО — сум и $
          не складываются. Цифры — уже посчитанные debtSummary. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["UZS", "USD"] as const).map((cur) => {
          const row = summary.activeByCurrency.find((r) => r.currency === cur && r.count > 0);
          return (
            <Card key={cur}>
              <p className="text-xs font-medium text-ink-2">
                {cur === "UZS" ? "Долг, сум" : "Долг, $"}
              </p>
              <p
                className={
                  "tnum mt-1 text-[28px] font-medium leading-9 " +
                  (row ? "text-carnelian" : "text-ink")
                }
              >
                {row ? formatDebtMoney(row.amount, cur) : "—"}
              </p>
            </Card>
          );
        })}
        <Card>
          <p className="text-xs font-medium text-ink-2">Должников</p>
          <p className="tnum mt-1 text-[28px] font-medium leading-9 text-ink">
            {summary.activeDebtorCount}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-ink-2">Просрочено</p>
          <p className="tnum mt-1 text-sm font-medium text-ink">
            {overdueLine ?? "—"}
          </p>
          {overdueCount > 0 && (
            <p className="mt-0.5 text-xs text-carnelian">
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
          <p className="mt-0.5 text-xs text-ink-3">
            Все невозвращённые продажи с указанным способом. По валютам
            отдельно.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {revenueLines.map((r) => (
              <li key={r.methodRu} className="flex flex-wrap justify-between gap-2">
                <span>{r.methodRu}</span>
                <span className="tnum font-medium text-ink">{r.line}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs
        className="mb-4"
        items={[
          { href: buildHref({ tab: "active", after: undefined }), label: "Активные", active: tab === "active" },
          { href: buildHref({ tab: "repaid", after: undefined, overdue: "" }), label: "Погашенные", active: tab === "repaid" },
        ]}
      />

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
                className="h-4 w-4"
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
        <EmptyState
          title={tab === "active" ? "Активных долгов нет." : "Погашенных долгов пока нет."}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              {g.debts.length > 1 && (
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink">
                    {g.customerName}
                    {g.customerContact && (
                      <span className="ml-2 text-sm font-normal text-ink-2">
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
              <div className="md:overflow-hidden md:rounded-card md:border md:border-line md:bg-marble">
                <DebtTableHead />
                <ul className="space-y-2 md:space-y-0">
                {g.debts.map((d) => (
                  <DebtCard
                    key={d.id}
                    d={d}
                    tab={tab}
                    returnTo={returnTo}
                  />
                ))}
                </ul>
              </div>
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
