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
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
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
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Объекты</h1>
        <p className="mt-1 text-sm text-ink/60">
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
        <Card>
          <p className="text-sm text-ink/65">
            Объектов не найдено. Их можно создать при продаже.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {sites.map((s) => {
            const money = formatCurrencySummaryLine(s.purchaseTotals);
            const vol = formatVolumeLine(s.volume);
            return (
              <li key={s.id}>
                <Link
                  href={`/obekty/${s.id}`}
                  className="block rounded-card border border-line bg-paper p-3 shadow-card transition hover:border-gold"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-ink">{s.name}</span>
                    <Badge
                      variant={s.status === "ACTIVE" ? "success" : "neutral"}
                    >
                      {SITE_STATUS_LABELS[s.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink/70">
                    {SITE_TYPE_LABELS[s.type]} · {s.clientName}
                  </p>
                  <p className="mt-1 text-sm text-ink/70">
                    {vol ?? "объём: —"}
                    {money && (
                      <>
                        {" · "}
                        <span className="tnum font-semibold text-ink">{money}</span>
                      </>
                    )}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/klienty" className={buttonClass("secondary", "sm")}>
          ← К клиентам
        </Link>
      </p>
    </main>
  );
}
