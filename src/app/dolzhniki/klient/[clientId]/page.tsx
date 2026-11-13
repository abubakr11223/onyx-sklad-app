// ТЗ №20 A §2.4 — «Внести платёж клиента»: клиент приносит одну сумму, а
// долгов у него несколько. Система раскладывает её от самого старого долга к
// новому и показывает раскладку ДО сохранения; менеджер может её поправить.
// Только долги в одной валюте (сум и $ не смешиваются).
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { currentActorId, getCapabilities } from "@/lib/session";
import { formatTashkentDate, todayTashkentISO } from "@/lib/datetime";
import {
  formatMoneyCents,
  loadClientOpenDebts,
  planClientPayment,
  toCents,
  PAY_METHODS,
  PAY_METHOD_LABEL,
  type PayCurrency,
} from "@/lib/payments";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { applyClientPaymentAction } from "../../actions";

export const metadata: Metadata = { title: "Платёж клиента — Onyx" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export default async function ClientPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  const actorId = await currentActorId();
  if (!actorId || (!caps.canSeeDebts && !caps.canSell)) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <NoAccess />
      </main>
    );
  }
  const { clientId } = await params;
  const sp = await searchParams;
  const currency: PayCurrency = first(sp.currency) === "USD" ? "USD" : "UZS";
  const totalRaw = first(sp.total).replace(/\s/g, "").replace(",", ".");
  const total = totalRaw ? Number(totalRaw) : null;
  const err = first(sp.err);

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, phone: true },
  });
  // Владелец — все долги клиента; менеджер — только по своим продажам.
  const debts = client
    ? await loadClientOpenDebts(db, {
        clientId,
        currency,
        managerId: caps.canSeeDebts ? null : actorId,
      })
    : [];
  const totalDebt = debts.reduce((s, d) => s + d.remainingCents, 0);
  const plan =
    total !== null && Number.isFinite(total) ? planClientPayment(debts, toCents(total)) : null;
  const planned = new Map(
    plan && plan.ok ? plan.lines.map((l) => [l.debtId, l.amountCents]) : [],
  );

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <Link href="/dolzhniki" className="text-sm text-honey-ink hover:underline">
        ← Должники
      </Link>
      <h1 className="mt-2 text-display font-semibold text-ink">Платёж клиента</h1>
      {!client ? (
        <Alert variant="danger" title="Клиент не найден" />
      ) : (
        <>
          <p className="mt-1 text-ink-2">
            {client.name} · {client.phone}
          </p>
          <div className="mt-3 flex gap-2 text-sm">
            {(["UZS", "USD"] as const).map((c) => (
              <Link
                key={c}
                href={`?currency=${c}`}
                className={
                  "rounded-field border px-3 py-1.5 " +
                  (c === currency ? "border-honey bg-honey-soft font-semibold" : "border-line")
                }
              >
                {c === "UZS" ? "сум" : "$"}
              </Link>
            ))}
          </div>

          {err && (
            <Alert variant="danger" title="Платёж не внесён" className="mt-3">
              <p>{err}</p>
            </Alert>
          )}

          {debts.length === 0 ? (
            <p className="mt-4 text-ink-2">Открытых долгов в этой валюте нет.</p>
          ) : (
            <>
              <p className="tnum mt-3 text-sm text-ink-2">
                Долгов: {debts.length} · всего {formatMoneyCents(totalDebt, currency)}
              </p>
              {/* Шаг 1 — сумма: раскладка считается от старого долга к новому. */}
              <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="currency" value={currency} />
                <label className="flex flex-col gap-0.5 text-sm text-ink-2">
                  Клиент принёс
                  <input
                    name="total"
                    inputMode="decimal"
                    defaultValue={total ?? ""}
                    className={inputClass + " tnum w-44"}
                    required
                  />
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Разложить
                </Button>
              </form>
              {plan && !plan.ok && (
                <p className="mt-2 text-sm text-carnelian">{plan.message}</p>
              )}

              {/* Шаг 2 — раскладка (можно поправить) и сохранение. */}
              {plan && plan.ok && (
                <Card className="mt-4">
                  <form action={applyClientPaymentAction} className="flex flex-col gap-3">
                    <input type="hidden" name="clientId" value={clientId} />
                    <input type="hidden" name="currency" value={currency} />
                    <ul className="flex flex-col gap-2">
                      {debts.map((d) => (
                        <li key={d.debtId} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm text-ink">
                            продажа {formatTashkentDate(d.soldAt)} · остаток{" "}
                            {formatMoneyCents(d.remainingCents, currency)}
                          </span>
                          <input
                            name={`alloc_${d.debtId}`}
                            inputMode="decimal"
                            aria-label={`Сумма на долг от ${formatTashkentDate(d.soldAt)}`}
                            defaultValue={((planned.get(d.debtId) ?? 0) / 100).toString()}
                            className={inputClass + " tnum w-36"}
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-ink-2">
                      {plan.lines
                        .map(
                          (l) =>
                            `${formatTashkentDate(debts.find((d) => d.debtId === l.debtId)!.soldAt)} — ${formatMoneyCents(l.amountCents, currency)} ${l.leftCents === 0 ? "(закрыт)" : `(остаток ${formatMoneyCents(l.leftCents, currency)})`}`,
                        )
                        .join(" · ")}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <select name="method" className={inputClass + " w-44"} defaultValue="CASH">
                        {PAY_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAY_METHOD_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        name="paidAt"
                        defaultValue={todayTashkentISO()}
                        className={inputClass + " w-44"}
                      />
                      <Button type="submit">Внести платёж</Button>
                    </div>
                  </form>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
