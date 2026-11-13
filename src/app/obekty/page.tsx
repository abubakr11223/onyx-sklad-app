// TZ №10+11 §7 — раздел «Объекты».

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import {
  SITE_STATUS_LABELS,
  SITE_TYPE_LABELS,
  type SiteStatus,
  type SiteType,
} from "@/lib/clients";
import {
  formatVolumeLine,
  listSitesDirectory,
} from "@/lib/clients-directory";
import { formatCurrencySummaryLine } from "@/lib/debts-ui";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Объекты — Onyx",
};

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export default async function ObektyPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeClients) {
    return (
      <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const q = first(sp.q);
  const statusRaw = first(sp.status);
  const status =
    statusRaw === "ACTIVE" || statusRaw === "COMPLETED"
      ? (statusRaw as SiteStatus)
      : "";
  const typeRaw = first(sp.type);
  const type =
    typeRaw === "RESIDENTIAL" ||
    typeRaw === "COMMERCIAL" ||
    typeRaw === "OTHER"
      ? (typeRaw as SiteType)
      : "";
  const clientId = first(sp.clientId);
  const actorId = await currentActorId();

  const [sites, clients] = await Promise.all([
    listSitesDirectory(db, {
      q,
      status,
      type,
      clientId: clientId || undefined,
      canSeeAllClients: caps.canSeeAllClients,
      actorId,
    }),
    db.client.findMany({
      where: caps.canSeeAllClients
        ? {}
        : actorId
          ? { managerId: actorId }
          : { managerId: "__none__" },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-4">
        <h1 className="text-display font-semibold text-ink">Объекты</h1>
        <p className="mt-1 text-sm text-ink-2">
          Стройки и площадки. Итоги отгрузки — из продаж (возвраты не считаются).
        </p>
      </header>

      <Card className="mb-4">
        <form className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Field id="q" label="Поиск" className="sm:flex-1">
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Название, адрес, заказчик"
              className={inputClass}
            />
          </Field>
          <Field id="status" label="Статус">
            <select
              id="status"
              name="status"
              defaultValue={status}
              className={inputClass}
            >
              <option value="">Все</option>
              <option value="ACTIVE">{SITE_STATUS_LABELS.ACTIVE}</option>
              <option value="COMPLETED">{SITE_STATUS_LABELS.COMPLETED}</option>
            </select>
          </Field>
          <Field id="type" label="Тип">
            <select id="type" name="type" defaultValue={type} className={inputClass}>
              <option value="">Все</option>
              <option value="RESIDENTIAL">{SITE_TYPE_LABELS.RESIDENTIAL}</option>
              <option value="COMMERCIAL">{SITE_TYPE_LABELS.COMMERCIAL}</option>
              <option value="OTHER">{SITE_TYPE_LABELS.OTHER}</option>
            </select>
          </Field>
          <Field id="clientId" label="Заказчик">
            <select
              id="clientId"
              name="clientId"
              defaultValue={clientId}
              className={inputClass}
            >
              <option value="">Все</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit">Найти</Button>
        </form>
      </Card>

      {sites.length === 0 ? (
        <EmptyState title="Объектов не найдено.">Их можно создать при продаже.</EmptyState>
      ) : (
        <>
          {/* ТЗ №20 §8: список — таблица; на телефоне — карточки (§9). */}
          <div className="onyx-table-wrap hidden md:block">
            <table className="onyx-table">
              <thead>
                <tr>
                  <th className="py-2 pl-3">Объект</th>
                  <th className="py-2 pl-3">Тип</th>
                  <th className="py-2 pl-3">Заказчик</th>
                  <th className="py-2 pl-3 text-right">Объём</th>
                  <th className="py-2 pl-3 text-right">Сумма</th>
                  <th className="py-2 px-3">Статус</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const money = formatCurrencySummaryLine(s.purchaseTotals);
                  const vol = formatVolumeLine(s.volume);
                  return (
                    <tr key={s.id} className="align-top">
                      <td className="py-2.5 pl-3">
                        <Link
                          href={`/obekty/${s.id}`}
                          className="font-medium text-ink hover:text-honey-ink hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="py-2.5 pl-3 text-ink-2">{SITE_TYPE_LABELS[s.type]}</td>
                      <td className="py-2.5 pl-3 text-ink-2">{s.clientName}</td>
                      <td className="tnum py-2.5 pl-3 text-right">{vol ?? <span className="text-ink-3">—</span>}</td>
                      <td className="tnum py-2.5 pl-3 text-right">{money || <span className="text-ink-3">—</span>}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant={s.status === "ACTIVE" ? "success" : "neutral"}>
                          {SITE_STATUS_LABELS[s.status]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        <ul className="flex flex-col gap-2 md:hidden">
          {sites.map((s) => {
            const money = formatCurrencySummaryLine(s.purchaseTotals);
            const vol = formatVolumeLine(s.volume);
            return (
              <li key={s.id}>
                <Link
                  href={`/obekty/${s.id}`}
                  className="block rounded-card border border-line bg-marble p-4 transition-colors duration-150 hover:border-line-strong"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-base font-medium text-ink">{s.name}</span>
                    <Badge
                      variant={s.status === "ACTIVE" ? "success" : "neutral"}
                    >
                      {SITE_STATUS_LABELS[s.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">
                    {SITE_TYPE_LABELS[s.type]} · {s.clientName}
                  </p>
                  <p className="mt-1 text-sm text-ink-2">
                    {vol ?? "объём: —"}
                    {money && (
                      <>
                        {" · "}
                        <span className="tnum font-medium text-ink">{money}</span>
                      </>
                    )}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
        </>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/klienty" className={buttonClass("secondary", "sm")}>
          ← К клиентам
        </Link>
      </p>
    </main>
  );
}
