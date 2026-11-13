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
import { collectionPath, listCollections } from "@/lib/collections";
import { formatCurrencySummaryLine, formatDebtMoney } from "@/lib/debts-ui";
import { PAYMENT_METHOD_LABEL } from "@/lib/validators/sale-payment";
import NoAccess from "@/components/NoAccess";
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
      <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
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

  const [samples, collections] = await Promise.all([
    listSamples(db, {
      canSeeAll: true,
      actorId,
      clientId: card.id,
      status: "ACTIVE",
    }),
    // ТЗ №20 I (§10.3) — подборки этого клиента (менеджер — свои, владелец — все).
    caps.canManageCollections
      ? listCollections(db, { caps, actorId, clientId: card.id, take: 50 })
      : Promise.resolve([]),
  ]);

  const purchaseLine = formatCurrencySummaryLine(card.purchaseTotals);
  const debtLine = formatCurrencySummaryLine(card.debtTotals);
  const volLine = formatVolumeLine(card.volume);

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
      <p className="mb-3">
        <Link href="/klienty" className="text-sm font-medium text-honey-ink hover:underline">
          ← Клиенты
        </Link>
      </p>

      <header className="mb-4">
        <h1 className="text-display font-semibold text-ink">{card.name}</h1>
        <p className="mt-1 text-sm text-ink-2">
          <Badge variant="neutral">{CLIENT_TYPE_LABELS[card.type]}</Badge>
          <span className="ml-2">{card.phone}</span>
        </p>
        {card.extraContacts && (
          <p className="mt-1 text-sm text-ink-2">Ещё: {card.extraContacts}</p>
        )}
        {card.comment && (
          <p className="mt-1 text-sm text-ink-2">{card.comment}</p>
        )}
        {caps.canSeeAllClients && (
          <p className="mt-1 text-xs text-ink-3">Менеджер: {card.managerName}</p>
        )}
      </header>

      <section className="mb-6" aria-label="Итоги">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Куплено (активные продажи)" line={purchaseLine} />
          <Kpi label="В долгу (активные)" line={debtLine} danger />
          <Kpi label="Объём" line={volLine ?? null} />
          <Kpi label="Продаж (без возвратов)" line={card.volume.saleCount} />
        </div>
        <p className="mt-2 text-xs text-ink-2">
          UZS и USD не суммируются. Возвращённые продажи в итог не входят.
        </p>
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-base font-semibold text-ink">
          Объекты ({card.sites.length})
        </h2>
        {card.sites.length === 0 ? (
          <p className="text-sm text-ink-2">Нет привязанных объектов.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.sites.map((s) => {
              const m = formatCurrencySummaryLine(s.purchaseTotals);
              const v = formatVolumeLine(s.volume);
              return (
                <li key={s.id}>
                  <Link
                    href={`/obekty/${s.id}`}
                    className="block rounded-card border border-line bg-marble p-3 hover:border-line-strong"
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
                    <p className="mt-1 text-sm text-ink-2">
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
        <h2 className="mb-2 text-base font-semibold text-ink">
          Продажи ({card.sales.length})
        </h2>
        {card.sales.length === 0 ? (
          <p className="text-sm text-ink-2">Продаж с привязкой к карточке нет.</p>
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
                    (returned ? "bg-marble opacity-70" : "bg-paper")
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
                  <p className="mt-1 text-ink-2">
                    {s.targetType}
                    {s.qtySlabs != null && s.qtySlabs > 0 && ` · ${s.qtySlabs} плит`}
                    {s.qtyAreaM2 && s.qtyAreaM2 !== "0" && ` · ${s.qtyAreaM2} м²`}
                    {" · "}
                    {pay}
                    {s.siteName ? ` · объект: ${s.siteName}` : " · без объекта"}
                  </p>
                  <p className="text-xs text-ink-3">Менеджер: {s.managerName}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-base font-semibold text-ink">
          Активные долги ({card.debts.filter((d) => d.status === "ACTIVE").length})
        </h2>
        {/* ТЗ №20 A §2.4 — одна сумма клиента на несколько долгов. */}
        {(caps.canSeeDebts || caps.canSell) &&
          (["UZS", "USD"] as const)
            .filter((c) => card.debts.some((d) => d.status === "ACTIVE" && d.currency === c))
            .map((c) => (
              <Link
                key={c}
                href={`/dolzhniki/klient/${card.id}?currency=${c}`}
                className="mb-2 mr-3 inline-block text-sm font-semibold text-gold-deep underline"
              >
                Внести платёж клиента ({c === "UZS" ? "сум" : "$"})
              </Link>
            ))}
        {card.debts.filter((d) => d.status === "ACTIVE").length === 0 ? (
          <p className="text-sm text-ink-2">Активных долгов нет.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.debts
              .filter((d) => d.status === "ACTIVE")
              .map((d) => (
                <li
                  key={d.id}
                  className="rounded-card border border-line bg-marble p-3 text-sm"
                >
                  <span className="tnum font-semibold">
                    {formatDebtMoney(d.amount, d.currency)}
                  </span>
                  {d.dueDate && (
                    <span className="ml-2 text-ink-2">
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
        <h2 className="mb-2 text-base font-semibold text-ink">
          Активные брони ({card.reservations.length})
        </h2>
        {card.reservations.length === 0 ? (
          <p className="text-sm text-ink-2">Активных броней не найдено.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {card.reservations.map((r) => (
              <li
                key={r.id}
                className="rounded-card border border-line bg-marble p-3 text-sm"
              >
                {r.targetType} · до {formatTashkentDate(r.expiresAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-base font-semibold text-ink">
          Активные образцы ({samples.length})
        </h2>
        {samples.length === 0 ? (
          <p className="text-sm text-ink-2">Активных образцов нет.</p>
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
                <p className="text-ink-2">
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

      {caps.canManageCollections && (
        <section className="mb-4">
          <h2 className="mb-2 text-base font-semibold text-ink">
            Подборки камней ({collections.length})
          </h2>
          {collections.length === 0 ? (
            <p className="text-sm text-ink-2">
              Подборок для клиента нет. Соберите в{" "}
              <Link href="/podborki" className="text-gold-deep underline">
                «Подборках»
              </Link>{" "}
              или кнопкой «В подборку» в каталоге.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {collections.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-marble p-3 text-sm"
                >
                  <span>
                    <Link href={`/podborki/${c.id}`} className="font-semibold text-ink underline">
                      {c.title}
                    </Link>
                    {c.closedAt && <span className="ml-2 text-ink-2">закрыта</span>}
                    <span className="block text-ink-2">
                      камней: <span className="tnum">{c.items}</span> · нравится:{" "}
                      <span className="tnum">{c.likes}</span> · {formatTashkentDate(c.createdAt)}
                    </span>
                  </span>
                  <Link href={collectionPath(c.code)} className="text-gold-deep underline">
                    Ссылка клиента
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

/**
 * Итог-KPI (ТЗ №20 §7.5): подпись 12px ink-2 сверху, цифра 28px Medium,
 * вторая валюта — отдельной строкой 14px. Валюты не складываются: строка
 * formatCurrencySummaryLine уже разделена по валютам («  ·  »).
 */
function Kpi({
  label,
  line,
  danger = false,
}: {
  label: string;
  line: string | number | null;
  danger?: boolean;
}) {
  const parts = line == null ? [] : String(line).split("  ·  ");
  const tone = danger && parts.length > 0 ? "text-carnelian" : "text-ink";
  return (
    <div className="rounded-card border border-line bg-marble p-4">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      {parts.length === 0 ? (
        <p className="mt-1 text-[28px] font-medium leading-9 text-ink-3">—</p>
      ) : (
        parts.map((p, i) => (
          <p
            key={i}
            className={
              i === 0
                ? `tnum mt-1 text-[28px] font-medium leading-9 ${tone}`
                : `tnum text-sm ${tone}`
            }
          >
            {p}
          </p>
        ))
      )}
    </div>
  );
}
