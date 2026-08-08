// TZ №10 — раздел «Образцы»: группировка по клиенту, просрочка, действия.
import type { Metadata } from "next";
import Link from "next/link";
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
import Field, { inputClass } from "@/components/ui/Field";
import {
  returnSampleAction,
  extendSampleAction,
  sellSampleAction,
} from "./actions";

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
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
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
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Образцы</h1>
        <p className="mt-1 text-sm text-ink/60">
          Камень на руках у клиента. Не продаётся повторно, пока активен.
        </p>
      </header>

      {ok && (
        <Alert variant="success" title="Готово" className="mb-3">
          {ok === "issued" &&
            "Образец выдан — камень списан со склада, запись в «Активные»."}
          {ok === "returned" && "Образец возвращён на склад."}
          {ok === "sold" && "Оформлена продажа, образец закрыт."}
          {ok === "extended" && "Срок возврата продлён."}
        </Alert>
      )}
      {err && (
        <Alert variant="danger" title="Ошибка" className="mb-3">
          {decodeURIComponent(err)}
        </Alert>
      )}

      <Card className="mb-4">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-ink/55">Активных</dt>
            <dd className="text-lg font-bold">{activeAll.length}</dd>
          </div>
          <div>
            <dt className="text-ink/55">Просроченных</dt>
            <dd className="text-lg font-bold text-warning">{overdueCount}</dd>
          </div>
          <div>
            <dt className="text-ink/55">Залоги на руках</dt>
            <dd className="tnum text-sm font-semibold">{depositLine ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link
          href="/obraztsy"
          className={
            tab === "active"
              ? "font-bold text-gold-deep"
              : "text-ink/60 underline"
          }
        >
          Активные
        </Link>
        <Link
          href="/obraztsy?tab=closed"
          className={
            tab === "closed"
              ? "font-bold text-gold-deep"
              : "text-ink/60 underline"
          }
        >
          Закрытые
        </Link>
        {tab === "active" && (
          <Link
            href="/obraztsy?overdue=1"
            className="text-ink/60 underline"
          >
            Только просроченные
          </Link>
        )}
      </div>

      {groups.size === 0 ? (
        <Card>
          <p className="text-sm text-ink/60">
            Образцов нет. Выдайте из раздела «Продажа».
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {[...groups.entries()].map(([clientId, list]) => (
            <section key={clientId}>
              <h2 className="mb-2 text-base font-semibold text-ink">
                <Link
                  href={`/klienty/${clientId}`}
                  className="text-gold-deep underline"
                >
                  {list[0].clientName}
                </Link>{" "}
                <span className="text-sm font-normal text-ink/55">
                  {list[0].clientPhone}
                </span>
              </h2>
              <ul className="flex flex-col gap-2">
                {list.map((s) => (
                  <li
                    key={s.id}
                    className={
                      "rounded-card border p-3 text-sm " +
                      (s.overdue
                        ? "border-warning/50 bg-warning/5"
                        : "border-line bg-paper")
                    }
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold text-ink">{s.stoneLabel}</span>
                      {s.overdue && (
                        <Badge variant="warning">просрочен</Badge>
                      )}
                      {s.status !== "ACTIVE" && (
                        <Badge variant="neutral">{s.status}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-ink/65">
                      Выдан {formatTashkentDate(s.issuedAt)} · вернуть до{" "}
                      {formatTashkentDate(s.returnDueDate)}
                      {s.depositAmount && s.depositCurrency && (
                        <>
                          {" · залог "}
                          {formatDebtMoney(s.depositAmount, s.depositCurrency)}
                        </>
                      )}
                    </p>
                    {s.locationNote && (
                      <p className="text-xs text-ink/50">Где: {s.locationNote}</p>
                    )}
                    {s.comment && (
                      <p className="text-xs text-ink/50">{s.comment}</p>
                    )}
                    {caps.canSeeAllClients && (
                      <p className="text-xs text-ink/45">
                        Менеджер: {s.managerName}
                      </p>
                    )}
                    {s.status === "ACTIVE" && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-2">
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
                          <label className="text-xs text-ink/60">
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
                        <form
                          action={sellSampleAction}
                          className="flex flex-col gap-2 rounded-field border border-line bg-paper-2 p-2"
                        >
                          <input type="hidden" name="sampleId" value={s.id} />
                          <p className="text-xs font-semibold text-ink">
                            Оформить продажу
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <Field id={`price-${s.id}`} label="Цена *">
                              <input
                                name="price"
                                required
                                inputMode="decimal"
                                className={inputClass}
                                placeholder="1500"
                              />
                            </Field>
                            <Field id={`cur-${s.id}`} label="Валюта">
                              <select name="currency" className={inputClass} defaultValue="UZS">
                                <option value="UZS">сум</option>
                                <option value="USD">$</option>
                              </select>
                            </Field>
                            <Field id={`pay-${s.id}`} label="Оплата">
                              <select name="paymentMethod" className={inputClass} defaultValue="CASH">
                                <option value="CASH">Наличные</option>
                                <option value="CARD">Карта</option>
                                <option value="CREDIT">В долг</option>
                              </select>
                            </Field>
                          </div>
                          <Button type="submit" size="sm">
                            Продать
                          </Button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-ink/50">
        Выдача образца — в «Продажа» → «Выдать как образец».
      </p>
    </main>
  );
}
