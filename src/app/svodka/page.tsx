// TZ №10+11 §9 — сводка владельца: топ клиентов/объектов, B2B vs B2C, период.
// Доступ: только OWNER (canSeeHistory). UZS/USD никогда не смешиваются.

import type { Metadata } from "next";
import Link from "next/link";
import { getCapabilities } from "@/lib/session";
import { loadOwnerSummary } from "@/lib/owner-summary";
import { formatCurrencySummaryLine, formatDebtMoney } from "@/lib/debts-ui";
import { formatVolumeLine } from "@/lib/clients-directory";
import { CLIENT_TYPE_LABELS } from "@/lib/clients";
import { db } from "@/lib/db";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Сводка — Onyx",
};

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function MoneyLines({
  rows,
}: {
  rows: ReadonlyArray<{ currency: "UZS" | "USD"; amount: string; count: number }>;
}) {
  if (rows.length === 0) return <span className="text-ink/50">—</span>;
  return (
    <span className="tnum font-semibold text-ink">
      {rows.map((r, i) => (
        <span key={r.currency}>
          {i > 0 && " · "}
          {formatDebtMoney(r.amount, r.currency)}
        </span>
      ))}
    </span>
  );
}

export default async function SvodkaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  // Owner-only (same class as «История» / «Должники»).
  if (!caps.canSeeHistory) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const fromQ = first(sp.from);
  const toQ = first(sp.to);

  const summary = await loadOwnerSummary(db, {
    fromISO: fromQ,
    toISO: toQ,
  });
  const { period, topClients, topSites, segments, grandTotals, saleCount } =
    summary;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Сводка владельца</h1>
        <p className="mt-1 text-sm text-ink/60">
          Топы и B2B/B2C за период. Возвраты не входят. UZS и USD — отдельно.
        </p>
      </header>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <Field id="from" label="С">
            <input
              type="date"
              id="from"
              name="from"
              defaultValue={period.fromISO}
              className={inputClass}
            />
          </Field>
          <Field id="to" label="По">
            <input
              type="date"
              id="to"
              name="to"
              defaultValue={period.toISO}
              className={inputClass}
            />
          </Field>
          <Button type="submit">Показать</Button>
        </form>
        <p className="mt-2 text-xs text-ink/50">
          Период: {period.fromISO} — {period.toISO} (Asia/Tashkent). По
          умолчанию — текущий месяц.
        </p>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
          Выручка периода
        </h2>
        <p className="text-lg">
          <MoneyLines rows={grandTotals} />
        </p>
        <p className="mt-1 text-sm text-ink/60">Продаж (без возвратов): {saleCount}</p>
      </Card>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold text-ink">B2B vs B2C</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-ink">
              B2B{" "}
              <span className="text-sm font-normal text-ink/55">
                (компания или объект)
              </span>
            </h3>
            <p className="mt-1">
              <MoneyLines rows={segments.b2b.totals} />
            </p>
            <p className="mt-1 text-sm text-ink/65">
              {formatVolumeLine(segments.b2b.volume) ?? "объём: —"} ·{" "}
              {segments.b2b.volume.saleCount} продаж
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold text-ink">
              B2C{" "}
              <span className="text-sm font-normal text-ink/55">
                (частные без объекта)
              </span>
            </h3>
            <p className="mt-1">
              <MoneyLines rows={segments.b2c.totals} />
            </p>
            <p className="mt-1 text-sm text-ink/65">
              {formatVolumeLine(segments.b2c.volume) ?? "объём: —"} ·{" "}
              {segments.b2c.volume.saleCount} продаж
            </p>
          </Card>
        </div>
        {segments.unlinked.volume.saleCount > 0 && (
          <p className="mt-2 text-sm text-ink/55">
            Без карточки клиента:{" "}
            <MoneyLines rows={segments.unlinked.totals} /> ·{" "}
            {segments.unlinked.volume.saleCount} продаж (не в B2B/B2C)
          </p>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Топ клиентов{" "}
          <Link href="/klienty" className="text-sm font-normal text-gold-deep underline">
            все →
          </Link>
        </h2>
        {topClients.length === 0 ? (
          <p className="text-sm text-ink/55">Нет продаж за период.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topClients.map((c, i) => (
              <li
                key={c.key}
                className="rounded-card border border-line bg-paper p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="text-ink/45">{i + 1}. </span>
                    {c.clientId ? (
                      <Link
                        href={`/klienty/${c.clientId}`}
                        className="font-semibold text-gold-deep underline"
                      >
                        {c.name}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink/70">{c.name}</span>
                    )}
                    {c.clientType && (
                      <Badge variant="neutral" className="ml-2">
                        {CLIENT_TYPE_LABELS[c.clientType]}
                      </Badge>
                    )}
                    {c.unlinked && (
                      <Badge variant="warning" className="ml-2">
                        legacy
                      </Badge>
                    )}
                  </span>
                  <MoneyLines rows={c.totals} />
                </div>
                <p className="mt-1 text-ink/55">
                  {c.saleCount} продаж
                  {formatVolumeLine(c.volume)
                    ? ` · ${formatVolumeLine(c.volume)}`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Топ объектов{" "}
          <Link href="/obekty" className="text-sm font-normal text-gold-deep underline">
            все →
          </Link>
        </h2>
        {topSites.length === 0 ? (
          <p className="text-sm text-ink/55">
            Нет продаж с привязкой к объекту за период.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topSites.map((s, i) => (
              <li
                key={s.siteId}
                className="rounded-card border border-line bg-paper p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="text-ink/45">{i + 1}. </span>
                    <Link
                      href={`/obekty/${s.siteId}`}
                      className="font-semibold text-gold-deep underline"
                    >
                      {s.name}
                    </Link>
                    {s.clientName && (
                      <span className="ml-2 text-ink/55">{s.clientName}</span>
                    )}
                  </span>
                  <MoneyLines rows={s.totals} />
                </div>
                <p className="mt-1 text-ink/55">
                  {s.saleCount} продаж
                  {formatVolumeLine(s.volume)
                    ? ` · ${formatVolumeLine(s.volume)}`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-center text-xs text-ink/45">
        {formatCurrencySummaryLine(grandTotals)
          ? "Суммы пересчитываются из продаж; возврат уменьшает итоги."
          : "Нет данных за выбранный период."}
      </p>
    </main>
  );
}
