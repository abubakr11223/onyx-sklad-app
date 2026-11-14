// TZ №10 — раздел «Образцы»: группировка по клиенту, просрочка, действия.
import type { Metadata } from "next";
import Link from "next/link";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ui/EmptyState";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import { listSamples, sumDepositsByCurrency } from "@/lib/samples";
import { formatDebtMoney, formatCurrencySummaryLine } from "@/lib/debts-ui";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import { inputClass } from "@/components/ui/Field";
import { returnSampleAction, extendSampleAction } from "./actions";
import SellSampleForm from "./SellSampleForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Образцы — Onyx" };

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export default async function ObraztsyPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return (
      <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const sp = await searchParams;
  const tab = first(sp.tab) === "closed" ? "closed" : "active";
  const overdueOnly = first(sp.overdue) === "1";
  const ok = first(sp.ok);
  const err = first(sp.err);
  const actorId = await currentActorId();
  const now = new Date();

  const items = await listSamples(db, {
    canSeeAll: caps.canSeeAllClients || caps.canSeeHistory,
    actorId,
    status: tab === "closed" ? "ALL" : "ACTIVE",
    overdueOnly: tab === "active" && overdueOnly,
    now,
  });

  const visible =
    tab === "closed"
      ? items.filter((i) => i.status === "RETURNED" || i.status === "SOLD")
      : items.filter((i) => i.status === "ACTIVE");

  const activeAll = await listSamples(db, {
    canSeeAll: caps.canSeeAllClients || caps.canSeeHistory,
    actorId,
    status: "ACTIVE",
    now,
  });
  const overdueCount = activeAll.filter((i) => i.overdue).length;
  const depositSum = sumDepositsByCurrency(activeAll);
  const depositLine = formatCurrencySummaryLine(
    depositSum.map((d) => ({
      currency: d.currency,
      amount: d.amount,
      count: d.count,
    })),
  );

  // Group by client
  const groups = new Map<string, typeof visible>();
  for (const it of visible) {
    const arr = groups.get(it.clientId) ?? [];
    arr.push(it);
    groups.set(it.clientId, arr);
  }

  return (
    <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-4">
        <h1 className="text-display font-semibold text-ink">Образцы</h1>
        <p className="mt-1 text-sm text-ink-2">
          Камень на руках у клиента. Не продаётся повторно, пока активен.
        </p>
      </header>

      {ok && (
        <Alert variant="success" title="Готово" className="mb-3">
          {ok === "issued"
            ? "Образец выдан — камень списан, запись в «Активные». Склад подтвердит физическую выдачу в «Отгрузки»."
            : ok === "returned"
              ? "Образец возвращён на склад."
              : ok === "sold"
                ? "Оформлена продажа, образец закрыт."
                : ok === "extended"
                  ? "Срок возврата продлён."
                  : // Unknown ok code — never empty green banner (silent success class)
                    "Операция выполнена."}
        </Alert>
      )}
      {err && (
        <Alert variant="danger" title="Ошибка" className="mb-3">
          {/* Actions send full RU message (encodeURIComponent); never a bare code. */}
          {(() => {
            try {
              return decodeURIComponent(err);
            } catch {
              return err || "Ошибка.";
            }
          })()}
        </Alert>
      )}

      <Card className="mb-4">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs font-medium text-ink-2">Активных</dt>
            <dd className="tnum mt-1 text-[28px] font-medium leading-9 text-ink">{activeAll.length}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-2">Просроченных</dt>
            <dd
              className={
                "tnum mt-1 text-[28px] font-medium leading-9 " +
                (overdueCount > 0 ? "text-carnelian" : "text-ink")
              }
            >
              {overdueCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-2">Залоги на руках</dt>
            <dd className="tnum mt-1 text-sm font-medium text-ink">{depositLine ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line">
        <Tabs
          underline={false}
          items={[
            { href: "/obraztsy", label: "Активные", active: tab === "active" },
            { href: "/obraztsy?tab=closed", label: "Закрытые", active: tab === "closed" },
          ]}
        />
        {tab === "active" && (
          <Link
            href="/obraztsy?overdue=1"
            className="flex min-h-10 items-center text-sm text-honey-ink hover:underline"
          >
            Только просроченные
          </Link>
        )}
      </div>

      {groups.size === 0 ? (
        <EmptyState title="Образцов нет.">Выдайте из раздела «Продажа».</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {[...groups.entries()].map(([clientId, list]) => (
            <section key={clientId}>
              <h2 className="mb-2 text-base font-semibold text-ink">
                <Link
                  href={`/klienty/${clientId}`}
                  className="text-ink hover:text-honey-ink hover:underline"
                >
                  {list[0].clientName}
                </Link>{" "}
                <span className="text-sm font-normal text-ink-2">
                  {list[0].clientPhone}
                </span>
              </h2>
              <ul className="flex flex-col gap-2">
                {list.map((s) => (
                  <li
                    key={s.id}
                    className={
                      "rounded-card border bg-marble p-4 text-sm " +
                      (s.overdue ? "border-carnelian-line" : "border-line")
                    }
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold text-ink">{s.stoneLabel}</span>
                      <span className="flex flex-wrap gap-1">
                        {s.awaitsWarehouse && s.status === "ACTIVE" && (
                          <Badge variant="warning">
                            ожидает выдачи со склада
                          </Badge>
                        )}
                        {s.overdue && (
                          <Badge variant="danger">просрочен</Badge>
                        )}
                        {s.status !== "ACTIVE" && (
                          <Badge variant="neutral">{s.status}</Badge>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-ink-2">
                      Выдан {formatTashkentDate(s.issuedAt)} · вернуть до{" "}
                      <span className={s.overdue ? "font-medium text-carnelian" : "text-ink"}>
                        {formatTashkentDate(s.returnDueDate)}
                      </span>
                      {s.depositAmount && s.depositCurrency && (
                        <>
                          {" · залог "}
                          <span className="tnum font-medium text-ink">
                            {formatDebtMoney(s.depositAmount, s.depositCurrency)}
                          </span>
                        </>
                      )}
                    </p>
                    {s.locationNote && (
                      <p className="text-xs text-ink-2">Где: {s.locationNote}</p>
                    )}
                    {s.comment && (
                      <p className="text-xs text-ink-2">{s.comment}</p>
                    )}
                    {caps.canSeeAllClients && (
                      <p className="text-xs text-ink-2">
                        Менеджер: {s.managerName}
                      </p>
                    )}
                    {s.status === "ACTIVE" && (
                      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                        <form action={returnSampleAction} className="inline">
                          <input type="hidden" name="sampleId" value={s.id} />
                          <Button type="submit" size="sm" variant="secondary">
                            Вернули
                          </Button>
                        </form>
                        <form
                          action={extendSampleAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="sampleId" value={s.id} />
                          <label className="text-xs text-ink-2">
                            Продлить до
                            <input
                              type="date"
                              name="returnDueDate"
                              required
                              className={inputClass + " mt-0.5 min-h-10"}
                            />
                          </label>
                          <Button type="submit" size="sm" variant="ghost">
                            Продлить срок
                          </Button>
                        </form>
                        {/* W1-T2: клиентская форма — useActionState, ввод не
                            теряется при ошибке, цена парсится как в SaleForm. */}
                        <SellSampleForm sampleId={s.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-ink-2">
        Выдача образца — в «Продажа» → «Выдать как образец».
      </p>
    </main>
  );
}
