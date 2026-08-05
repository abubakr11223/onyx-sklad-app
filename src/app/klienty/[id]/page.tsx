// TZ №10+11 §7 — карточка клиента.
// Образцы (этап 4) не показываем — в разметке только место-комментарий.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import {
  CLIENT_TYPE_LABELS,
  SITE_STATUS_LABELS,
  SITE_TYPE_LABELS,
} from "@/lib/clients";
import {
  formatVolumeLine,
  getClientDirectoryCard,
} from "@/lib/clients-directory";
import { listSamples } from "@/lib/samples";
import { formatCurrencySummaryLine, formatDebtMoney } from "@/lib/debts-ui";
import { PAYMENT_METHOD_LABEL } from "@/lib/validators/sale-payment";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Клиент — Onyx",
};

export default async function ClientCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeClients) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const { id } = await params;
  const actorId = await currentActorId();
  const card = await getClientDirectoryCard(db, {
    clientId: id,
    canSeeAllClients: caps.canSeeAllClients,
    actorId,
  });
  if (!card) notFound();

  const samples = await listSamples(db, {
    canSeeAll: true,
    actorId,
    clientId: card.id,
    status: "ACTIVE",
  });

  const purchaseLine = formatCurrencySummaryLine(card.purchaseTotals);
  const debtLine = formatCurrencySummaryLine(card.debtTotals);
  const volLine = formatVolumeLine(card.volume);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <p className="mb-3">
        <Link href="/klienty" className="text-sm font-semibold text-gold-deep">
          ← Клиенты
        </Link>
      </p>

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">{card.name}</h1>
        <p className="mt-1 text-sm text-ink/70">
          <Badge variant="neutral">{CLIENT_TYPE_LABELS[card.type]}</Badge>
          <span className="ml-2">{card.phone}</span>
        </p>
        {card.extraContacts && (
          <p className="mt-1 text-sm text-ink/60">Ещё: {card.extraContacts}</p>
        )}
        {card.comment && (
          <p className="mt-1 text-sm text-ink/55">{card.comment}</p>
        )}
        {caps.canSeeAllClients && (
          <p className="mt-1 text-xs text-ink/45">Менеджер: {card.managerName}</p>
        )}
      </header>

      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
          Итоги
        </h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink/60">Куплено (активные продажи)</dt>
            <dd className="tnum text-right font-semibold text-ink">
              {purchaseLine ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink/60">В долгу (активные)</dt>
            <dd className="tnum text-right font-semibold text-ink">
              {debtLine ?? "—"}
            </dd>
          </div>
          {volLine && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/60">Объём</dt>
              <dd className="text-right text-ink">{volLine}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-ink/60">Продаж (без возвратов)</dt>
            <dd className="text-right text-ink">{card.volume.saleCount}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink/45">
          UZS и USD не суммируются. Возвращённые продажи в итог не входят.
        </p>
      </Card>

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Объекты ({card.sites.length})
        </h2>
        {card.sites.length === 0 ? (
          <p className="text-sm text-ink/55">Нет привязанных объектов.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.sites.map((s) => {
              const m = formatCurrencySummaryLine(s.purchaseTotals);
              const v = formatVolumeLine(s.volume);
              return (
                <li key={s.id}>
                  <Link
                    href={`/obekty/${s.id}`}
                    className="block rounded-card border border-line bg-paper p-3 hover:border-gold"
                  >
                    <span className="font-semibold text-ink">{s.name}</span>
                    <Badge variant="neutral" className="ml-2">
                      {SITE_TYPE_LABELS[s.type]}
                    </Badge>
                    <Badge
                      variant={s.status === "ACTIVE" ? "success" : "neutral"}
                      className="ml-1"
                    >
                      {SITE_STATUS_LABELS[s.status]}
                    </Badge>
                    <p className="mt-1 text-sm text-ink/70">
                      {v ?? "без объёма"}
                      {m && (
                        <>
                          {" · "}
                          <span className="tnum font-semibold">{m}</span>
                        </>
                      )}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Продажи ({card.sales.length})
        </h2>
        {card.sales.length === 0 ? (
          <p className="text-sm text-ink/55">Продаж с привязкой к карточке нет.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.sales.map((s) => {
              const returned = s.returnedAt != null;
              const pay =
                s.paymentMethod &&
                s.paymentMethod in PAYMENT_METHOD_LABEL
                  ? PAYMENT_METHOD_LABEL[
                      s.paymentMethod as keyof typeof PAYMENT_METHOD_LABEL
                    ]
                  : s.paymentMethod ?? "—";
              return (
                <li
                  key={s.id}
                  className={
                    "rounded-card border border-line p-3 text-sm " +
                    (returned ? "bg-paper-2 opacity-70" : "bg-paper")
                  }
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold text-ink">
                      {formatTashkentDate(s.soldAt)}
                      {returned && (
                        <Badge variant="warning" className="ml-2">
                          возврат
                        </Badge>
                      )}
                    </span>
                    <span className="tnum font-semibold">
                      {s.price != null && s.currency
                        ? formatDebtMoney(s.price, s.currency)
                        : "—"}
                    </span>
                  </div>
                  <p className="mt-1 text-ink/70">
                    {s.targetType}
                    {s.qtySlabs != null && s.qtySlabs > 0 && ` · ${s.qtySlabs} плит`}
                    {s.qtyAreaM2 && s.qtyAreaM2 !== "0" && ` · ${s.qtyAreaM2} м²`}
                    {" · "}
                    {pay}
                    {s.siteName ? ` · объект: ${s.siteName}` : " · без объекта"}
                  </p>
                  <p className="text-xs text-ink/45">Менеджер: {s.managerName}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Активные долги ({card.debts.filter((d) => d.status === "ACTIVE").length})
        </h2>
        {card.debts.filter((d) => d.status === "ACTIVE").length === 0 ? (
          <p className="text-sm text-ink/55">Активных долгов нет.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.debts
              .filter((d) => d.status === "ACTIVE")
              .map((d) => (
                <li
                  key={d.id}
                  className="rounded-card border border-line bg-paper p-3 text-sm"
                >
                  <span className="tnum font-semibold">
                    {formatDebtMoney(d.amount, d.currency)}
                  </span>
                  {d.dueDate && (
                    <span className="ml-2 text-ink/60">
                      срок {formatTashkentDate(d.dueDate)}
                    </span>
                  )}
                  {caps.canSeeDebts && (
                    <Link
                      href="/dolzhniki"
                      className="ml-2 text-gold-deep underline"
                    >
                      к должникам
                    </Link>
                  )}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Активные брони ({card.reservations.length})
        </h2>
        {card.reservations.length === 0 ? (
          <p className="text-sm text-ink/55">Активных броней не найдено.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.reservations.map((r) => (
              <li
                key={r.id}
                className="rounded-card border border-line bg-paper p-3 text-sm"
              >
                {r.targetType} · до {formatTashkentDate(r.expiresAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Активные образцы ({samples.length})
        </h2>
        {samples.length === 0 ? (
          <p className="text-sm text-ink/55">Активных образцов нет.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {samples.map((s) => (
              <li
                key={s.id}
                className={
                  "rounded-card border p-3 text-sm " +
                  (s.overdue ? "border-warning/50 bg-warning/5" : "border-line bg-paper")
                }
              >
                <span className="font-semibold">{s.stoneLabel}</span>
                {s.overdue && (
                  <span className="ml-2 text-warning">просрочен</span>
                )}
                <p className="text-ink/60">
                  до {formatTashkentDate(s.returnDueDate)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm">
          <a href="/obraztsy" className="text-gold-deep underline">
            Все образцы →
          </a>
        </p>
      </section>
    </main>
  );
}
