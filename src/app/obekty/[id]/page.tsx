// TZ №10+11 §7 — карточка объекта + «отметить завершённым».

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import {
  SITE_STATUS_LABELS,
  SITE_TYPE_LABELS,
} from "@/lib/clients";
import {
  formatVolumeLine,
  getSiteDirectoryCard,
} from "@/lib/clients-directory";
import { formatCurrencySummaryLine, formatDebtMoney } from "@/lib/debts-ui";
import { PAYMENT_METHOD_LABEL } from "@/lib/validators/sale-payment";
import NoAccess from "@/components/NoAccess";
import Badge from "@/components/ui/Badge";
import Kpi from "@/components/ui/Kpi";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import { completeSiteAction } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Объект — Onyx",
};

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

const OK_RU: Record<string, string> = {
  completed: "Объект отмечен завершённым.",
};
const ERR_RU: Record<string, string> = {
  denied: "Недостаточно прав.",
  notfound: "Объект не найден.",
  already: "Объект уже завершён.",
  fail: "Не удалось обновить статус.",
};

export default async function SiteCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
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
  const sp = await searchParams;
  const actorId = await currentActorId();
  const card = await getSiteDirectoryCard(db, {
    siteId: id,
    canSeeAllClients: caps.canSeeAllClients,
    actorId,
  });
  if (!card) notFound();

  const purchaseLine = formatCurrencySummaryLine(card.purchaseTotals);
  const debtLine = formatCurrencySummaryLine(card.debtTotals);
  const volLine = formatVolumeLine(card.volume);
  const ok = first(sp.ok);
  const err = first(sp.err);

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
      <p className="mb-3">
        <Link href="/obekty" className="text-sm font-medium text-honey-ink hover:underline">
          ← Объекты
        </Link>
      </p>

      {ok && OK_RU[ok] && (
        <Alert variant="success" title="Готово" className="mb-3">
          {OK_RU[ok]}
        </Alert>
      )}
      {err && ERR_RU[err] && (
        <Alert variant="danger" title="Ошибка" className="mb-3">
          {ERR_RU[err]}
        </Alert>
      )}

      <header className="mb-4">
        <h1 className="text-display font-semibold text-ink">{card.name}</h1>
        <p className="mt-1 text-sm text-ink-2">
          <Badge variant="neutral">{SITE_TYPE_LABELS[card.type]}</Badge>
          <Badge
            variant={card.status === "ACTIVE" ? "success" : "neutral"}
            className="ml-1"
          >
            {SITE_STATUS_LABELS[card.status]}
          </Badge>
        </p>
        {card.address && (
          <p className="mt-1 text-sm text-ink-2">Адрес: {card.address}</p>
        )}
        <p className="mt-1 text-sm text-ink-2">
          Заказчик:{" "}
          <Link
            href={`/klienty/${card.clientId}`}
            className="font-semibold text-gold-deep underline"
          >
            {card.clientName}
          </Link>{" "}
          · {card.clientPhone}
        </p>
        {card.contactPerson && (
          <p className="mt-1 text-sm text-ink-2">
            Контакт на объекте: {card.contactPerson}
          </p>
        )}
        {card.comment && (
          <p className="mt-1 text-sm text-ink-2">{card.comment}</p>
        )}
        {caps.canSeeAllClients && (
          <p className="mt-1 text-xs text-ink-3">Менеджер: {card.managerName}</p>
        )}
      </header>

      <section className="mb-6" aria-label="Итоги отгрузки">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Сумма (активные продажи)" line={purchaseLine} />
          <Kpi label="Объём" line={volLine ?? null} />
          <Kpi label="В долгу по объекту" line={debtLine} danger />
          <Kpi label="Продаж (без возвратов)" line={card.volume.saleCount} />
        </div>
      </section>

      {card.status === "ACTIVE" && (
        <form action={completeSiteAction} className="mb-4">
          <input type="hidden" name="siteId" value={card.id} />
          <Button type="submit" variant="secondary">
            Отметить завершённым
          </Button>
        </form>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold text-ink">
          Продажи на объект ({card.sales.length})
        </h2>
        {card.sales.length === 0 ? (
          <p className="text-sm text-ink-2">
            Продаж с привязкой к этому объекту нет. Частные продажи без объекта
            сюда не попадают.
          </p>
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
                    <span className="font-semibold">
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
                  </p>
                  <p className="text-xs text-ink-3">Менеджер: {s.managerName}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
